/**
 * Phase 1 identity-foundation migration contract tests.
 *
 * These tests read the migration file and assert its shape. They do not need a
 * database, so they always run. Behavioural constraints (uniqueness, FKs,
 * idempotency, instrument preservation) are covered by
 * tests/phase1/identity-schema.integration.test.ts when a disposable database
 * URL is supplied.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// CommonJS modules shared with db/migrate.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { splitStatements } = require(join(__dirname, '..', '..', 'db', 'sql-statements'));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATION_NAME = '2026-11-12-add-internal-identity-foundation.sql';
const MIGRATION_PATH = join(DB_DIR, 'migrations', MIGRATION_NAME);

function stripCommentLines(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const rawSql = readFileSync(MIGRATION_PATH, 'utf8');
const sql = stripCommentLines(rawSql);
const statements: string[] = splitStatements(rawSql);

function createdTables(): string[] {
  return statements
    .map((s) => s.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)?.[1])
    .filter((name): name is string => Boolean(name));
}

describe('Phase 1 migration is additive and single-purpose', () => {
  test('the migration exists and is ordered before the Phase 1.5 migration', () => {
    const files = readdirSync(join(DB_DIR, 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toContain(MIGRATION_NAME);
    expect(files.indexOf(MIGRATION_NAME)).toBeLessThan(
      files.indexOf('2026-11-12-add-phase1-5-broker-market-data.sql')
    );
  });

  test('it creates exactly the four Phase 1 tables', () => {
    expect(createdTables().sort()).toEqual([
      'admin_audit_log',
      'app_users',
      'instrument_aliases',
      'user_identities',
    ]);
  });

  test('every statement is a CREATE and every CREATE is IF NOT EXISTS', () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE\b/i);
      expect(statement).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });

  test('no destructive or existing-table-altering statement is present', () => {
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|INDEX|COLUMN)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
  });
});

describe('app_users contract', () => {
  test('has the required columns and no password column', () => {
    expect(EXPECTED_SCHEMA.app_users).toEqual([
      'user_id',
      'email',
      'display_name',
      'status',
      // Added by Phase 2 (2026-11-12-add-phase2-firebase-auth.sql).
      'role',
      'created_at',
      'updated_at',
    ]);
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app_users/i);
    expect(sql).toMatch(/user_id\s+UUID\s+PRIMARY\s+KEY\s+DEFAULT\s+gen_random_uuid\(\)/i);
    expect(sql).not.toMatch(/\bpassword\b/i);
    expect(sql).not.toMatch(/\bpassword_hash\b/i);
  });

  test('status is constrained to the three approved values', () => {
    expect(sql).toMatch(
      /app_users_status_chk\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'ACTIVE'\s*,\s*'SUSPENDED'\s*,\s*'DISABLED'\s*\)\s*\)/i
    );
  });

  test('email uniqueness is case-insensitive and trimmed', () => {
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+app_users_email_lower_uq\s+ON\s+app_users\s*\(\s*lower\s*\(\s*btrim\s*\(\s*email\s*\)\s*\)\s*\)/i
    );
  });
});

describe('user_identities contract', () => {
  test('provider identity maps to an internal user and is unique per provider', () => {
    expect(EXPECTED_SCHEMA.user_identities).toEqual([
      'identity_id',
      'user_id',
      'provider',
      'provider_user_id',
      'created_at',
      'updated_at',
    ]);
    expect(sql).toMatch(
      /user_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+app_users\s*\(\s*user_id\s*\)\s+ON\s+DELETE\s+CASCADE/i
    );
    expect(sql).toMatch(
      /CONSTRAINT\s+user_identities_provider_user_uq\s+UNIQUE\s*\(\s*provider\s*,\s*provider_user_id\s*\)/i
    );
    expect(sql).toMatch(/provider\s+IN\s*\(\s*'FIREBASE'\s*\)/i);
  });
});

describe('admin_audit_log contract', () => {
  test('actor is optional and metadata is a JSON object', () => {
    expect(EXPECTED_SCHEMA.admin_audit_log).toEqual([
      'audit_id',
      'actor_user_id',
      'action',
      'target_entity_type',
      'target_entity_id',
      'metadata',
      'created_at',
    ]);
    expect(sql).toMatch(
      /actor_user_id\s+UUID\s+REFERENCES\s+app_users\s*\(\s*user_id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i
    );
    expect(sql).toMatch(/metadata\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'::jsonb/i);
    expect(sql).toMatch(/jsonb_typeof\s*\(\s*metadata\s*\)\s*=\s*'object'/i);
  });

  test('the audit table stores no credential columns', () => {
    expect(sql).not.toMatch(/\b(access_token|refresh_token|api_secret|password)\b/i);
  });
});

describe('instrument_aliases contract', () => {
  test('aliases reference the existing numeric instrument id without changing it', () => {
    expect(EXPECTED_SCHEMA.instrument_aliases).toEqual([
      'alias_id',
      'instrument_id',
      'provider',
      'provider_instrument_key',
      'exchange',
      'trading_symbol',
      'instrument_type',
      'segment',
      'created_at',
      'updated_at',
    ]);
    expect(sql).toMatch(
      /instrument_id\s+BIGINT\s+NOT\s+NULL\s+REFERENCES\s+instruments\s*\(\s*instrument_id\s*\)\s+ON\s+DELETE\s+RESTRICT/i
    );
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+instruments/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+instruments/i);
  });

  test('provider key is unique and multiple aliases per instrument are allowed', () => {
    expect(sql).toMatch(/provider\s+IN\s*\(\s*'KITE'\s*,\s*'UPSTOX'\s*\)/i);
    expect(sql).toMatch(
      /CONSTRAINT\s+instrument_aliases_provider_key_uq\s+UNIQUE\s*\(\s*provider\s*,\s*provider_instrument_key\s*\)/i
    );
    // No UNIQUE(instrument_id) constraint: one instrument may have many aliases.
    expect(sql).not.toMatch(/UNIQUE\s*\(\s*instrument_id\s*\)/i);
  });

  test('lookup indexes cover instrument id and provider/symbol', () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+instrument_aliases_instrument_idx\s+ON\s+instrument_aliases\s*\(\s*instrument_id\s*\)/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+instrument_aliases_provider_symbol_idx\s+ON\s+instrument_aliases\s*\(\s*provider\s*,\s*trading_symbol\s*\)/i
    );
  });
});
