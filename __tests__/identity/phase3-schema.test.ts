/**
 * Phase 3 migration, runner and ownership contracts.
 *
 * These are static checks: they need no database. Behaviour against a
 * disposable Postgres lives in tests/phase3 (skipped unless
 * PHASE3_TEST_DATABASE_URL is set).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { splitStatements } = require(join(__dirname, '..', '..', 'db', 'sql-statements'));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const ROOT = join(__dirname, '..', '..');
const DB_DIR = join(ROOT, 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const MIGRATION_NAME = '2026-11-13-live-trade-internal-ownership.sql';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_NAME);
const OWNER_TABLES = [
  'live_trade_groups',
  'live_trade_items',
  'live_trade_quote_state',
];

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const rawSql = readFileSync(MIGRATION_PATH, 'utf8');
const sql = stripComments(rawSql);
const statements: string[] = splitStatements(rawSql);

function statementIndex(pattern: RegExp): number {
  return statements.findIndex((statement) => pattern.test(statement));
}

describe('Phase 3 migration', () => {
  test('exists and sorts after every earlier migration', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toContain(MIGRATION_NAME);
    expect(files.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      files.indexOf('2026-11-12-add-phase2-firebase-auth.sql')
    );
    expect(files.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      files.indexOf('2026-11-09-live-trade-allow-repeat-instruments.sql')
    );
    // Phase 4 may sort after this migration; every file after it must still be
    // a later phase.
    for (const later of files.slice(files.indexOf(MIGRATION_NAME) + 1)) {
      expect(later > MIGRATION_NAME).toBe(true);
    }
  });

  test('contains no data-mutating or privilege statements', () => {
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  test('drops the legacy repeat-instrument index and never recreates it', () => {
    expect(statementIndex(/^DROP INDEX IF EXISTS live_trade_items_owner_instrument_uq$/i)).toBeGreaterThanOrEqual(0);
    expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[^;]*live_trade_items_owner_instrument_uq/i);
    expect(sql).not.toMatch(/UNIQUE\s*\(\s*owner_user_id\s*,\s*instrument_id\s*\)/i);
  });

  test('drops the text CHECK constraints and composite FK before changing types', () => {
    const firstTypeChange = statementIndex(
      /ALTER TABLE live_trade_groups\s+ALTER COLUMN owner_user_id TYPE UUID/i
    );
    expect(firstTypeChange).toBeGreaterThanOrEqual(0);

    for (const constraint of [
      'live_trade_groups_owner_not_blank',
      'live_trade_items_owner_not_blank',
      'live_trade_quote_state_owner_not_blank',
      'live_trade_items_group_owner_fk',
    ]) {
      const dropIndex = statementIndex(
        new RegExp(`DROP CONSTRAINT IF EXISTS ${constraint}$`, 'i')
      );
      expect({ constraint, dropIndex }).toEqual({
        constraint,
        dropIndex: expect.any(Number),
      });
      expect(dropIndex).toBeLessThan(firstTypeChange);
    }
  });

  test('converts every owner column to UUID before setting NOT NULL', () => {
    const typeChangeIndexes = OWNER_TABLES.map((table) =>
      statementIndex(
        new RegExp(
          `ALTER TABLE ${table}\\s+ALTER COLUMN owner_user_id TYPE UUID USING owner_user_id::uuid$`,
          'i'
        )
      )
    );
    const notNullIndexes = OWNER_TABLES.map((table) =>
      statementIndex(
        new RegExp(
          `ALTER TABLE ${table}\\s+ALTER COLUMN owner_user_id SET NOT NULL$`,
          'i'
        )
      )
    );

    for (const index of [...typeChangeIndexes, ...notNullIndexes]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...typeChangeIndexes)).toBeLessThan(Math.min(...notNullIndexes));
  });

  test('adds an app_users foreign key with cascade to every owner table', () => {
    const firstForeignKey = statementIndex(
      /ADD CONSTRAINT live_trade_groups_owner_fk/i
    );
    expect(firstForeignKey).toBeGreaterThanOrEqual(0);

    for (const table of OWNER_TABLES) {
      const index = statementIndex(
        new RegExp(
          `ALTER TABLE ${table}\\s+ADD CONSTRAINT ${table}_owner_fk\\s+FOREIGN KEY \\(owner_user_id\\) REFERENCES app_users\\(user_id\\) ON DELETE CASCADE$`,
          'i'
        )
      );
      expect({ table, index }).toEqual({ table, index: expect.any(Number) });
      expect(index).toBeGreaterThan(firstForeignKey - 1);
    }
  });

  test('keeps the composite group foreign key NO ACTION', () => {
    const composite = statements.find((statement) =>
      /ADD CONSTRAINT live_trade_items_group_owner_fk/i.test(statement)
    );
    expect(composite).toBeDefined();
    expect(composite).toMatch(
      /FOREIGN KEY \(group_id, owner_user_id\)\s+REFERENCES live_trade_groups \(group_id, owner_user_id\)/i
    );
    expect(composite).not.toMatch(/ON DELETE/i);
  });

  test('creates kite_session_bindings with both foreign keys and an owner index', () => {
    const create = statements.find((statement) =>
      /CREATE TABLE IF NOT EXISTS kite_session_bindings/i.test(statement)
    );
    expect(create).toBeDefined();
    expect(create).toMatch(/session_id_hash\s+TEXT\s+PRIMARY KEY REFERENCES kite_sessions\(session_id_hash\) ON DELETE CASCADE/i);
    expect(create).toMatch(/app_user_id\s+UUID\s+NOT NULL REFERENCES app_users\(user_id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS kite_session_bindings_user_idx\s+ON kite_session_bindings \(app_user_id\)/i
    );
  });

  test('the shared schema contract includes every Phase 3 column', () => {
    for (const table of OWNER_TABLES) {
      expect(EXPECTED_SCHEMA[table]).toContain('owner_user_id');
    }
    expect(EXPECTED_SCHEMA.kite_session_bindings).toEqual([
      'session_id_hash',
      'app_user_id',
      'created_at',
    ]);
  });
});

describe('targeted Phase 3 migration runner', () => {
  const runner = readFileSync(join(DB_DIR, 'migrate-phase3.js'), 'utf8');

  test('requires an explicitly approved disposable target', () => {
    expect(runner).toContain('PHASE3_DATABASE_URL');
    expect(runner).toContain('ALLOW_PHASE3_MIGRATION');
    expect(runner).toContain('EXPECTED_PHASE3_HOST');
    expect(runner).toContain('FORBIDDEN_DATABASE_HOST');
  });

  test('refuses production, pooled, and non-Neon targets', () => {
    expect(runner).toMatch(/NODE_ENV/);
    expect(runner).toMatch(/production/);
    expect(runner).toMatch(/pooled|pooler/i);
  });

  test('never falls back to DATABASE_URL', () => {
    expect(runner).not.toMatch(/process\.env\.DATABASE_URL/);
  });

  test('only applies the Phase 3 migration file', () => {
    expect(runner).toContain(MIGRATION_NAME);
    expect(runner).toMatch(/ALLOWED_STATEMENTS/);
  });

  test('refuses to convert legacy TEXT ownership that still has rows', () => {
    expect(runner).toContain('information_schema.columns');
    expect(runner).toMatch(/legacy|TEXT/i);
    expect(runner).toMatch(/count\(\*\)/i);
    expect(runner).toMatch(/No owner mapping|no owner mapping|No statements were executed/i);
  });

  test('verifies the resulting types, foreign keys, composite FK and repeat index', () => {
    expect(runner).toContain('pg_get_constraintdef');
    expect(runner).toMatch(/ON DELETE CASCADE/i);
    expect(runner).toMatch(/live_trade_items_owner_instrument_uq/);
    expect(runner).toMatch(/kite_session_bindings/);
  });

  test('is wired to an explicit npm script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:phase3:migrate']).toBe('node db/migrate-phase3.js');
  });
});

describe('Live Trade ownership implementation', () => {
  const ownership = readFileSync(
    join(ROOT, 'lib', 'live-trade', 'ownership.ts'),
    'utf8'
  );
  const quotesRoute = readFileSync(
    join(ROOT, 'app', 'api', 'live-trade', 'quotes', 'route.ts'),
    'utf8'
  );
  const repository = readFileSync(
    join(ROOT, 'lib', 'live-trade', 'repository.ts'),
    'utf8'
  );

  test('derives the owner only from requireAppUser()', () => {
    expect(ownership).toContain('requireAppUser');
    expect(ownership).not.toContain('getSessionFromRequest');
    expect(ownership).not.toContain('kite-session');
  });

  test('maps suspended, disabled and forbidden accounts to 403', () => {
    expect(ownership).toMatch(/SUSPENDED/);
    expect(ownership).toMatch(/DISABLED/);
    expect(ownership).toMatch(/new LiveTradeError\("FORBIDDEN"\)/);
    expect(ownership).toMatch(/new LiveTradeError\("UNAUTHENTICATED"\)/);
  });

  test('quote reads require a bound Kite session and never fall back', () => {
    expect(quotesRoute).toContain('getBoundKiteSession');
    expect(quotesRoute).toContain('BROKER_NOT_CONNECTED');
    expect(quotesRoute).not.toContain('getSessionFromRequest');
  });

  test('repository owner parameters are cast to UUID', () => {
    const casts = repository.match(/\$\d+::uuid/g) ?? [];
    expect(casts.length).toBeGreaterThanOrEqual(3);
    expect(repository).toContain('owner_user_id');
    expect(repository).not.toMatch(/owner_user_id\s+TEXT/i);
  });
});
