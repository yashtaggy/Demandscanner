/**
 * Phase 2 migration and operator-script contracts.
 *
 * These are static checks: they need no database. Behaviour against a
 * disposable Postgres lives in tests/phase2 (skipped unless
 * PHASE2_TEST_DATABASE_URL is set).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { splitStatements } = require(join(__dirname, '..', '..', 'db', 'sql-statements'));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const ROOT = join(__dirname, '..', '..');
const DB_DIR = join(ROOT, 'db');
const MIGRATION_NAME = '2026-11-12-add-phase2-firebase-auth.sql';
const MIGRATION_PATH = join(DB_DIR, 'migrations', MIGRATION_NAME);

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

describe('Phase 2 migration', () => {
  test('exists and is ordered after the Phase 1.5 migration', () => {
    const files = readdirSync(join(DB_DIR, 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toContain(MIGRATION_NAME);
    expect(files.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      files.indexOf('2026-11-12-add-phase1-5-broker-market-data.sql')
    );
  });

  test('only contains additive CREATE and guarded ADD COLUMN statements', () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const additive =
        /^CREATE\b/i.test(statement) ||
        /^ALTER\s+TABLE\s+(app_users|scan_jobs)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(
          statement
        );
      expect(additive).toBe(true);
    }
  });

  test('contains no destructive or data-mutating statements', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
  });

  test('adds role with CUSTOMER default and a role check', () => {
    expect(sql).toMatch(/app_users\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+role/i);
    expect(sql).toMatch(/DEFAULT\s+'CUSTOMER'/i);
    expect(sql).toMatch(/CHECK\s*\(\s*role\s+IN\s*\(\s*'SUPER_ADMIN'\s*,\s*'ADMIN'\s*,\s*'CUSTOMER'\s*\)\s*\)/i);
  });

  test('adds a nullable app-user owner to scan_jobs without rewriting legacy rows', () => {
    expect(sql).toMatch(
      /scan_jobs\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+initiator_user_id\s+UUID/i
    );
    expect(sql).toMatch(/REFERENCES\s+app_users\s*\(\s*user_id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    expect(sql).not.toMatch(/SET\s+NOT\s+NULL/i);
  });

  test('creates the rate-limit table used by auth endpoints', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+auth_rate_limits/i);
    expect(sql).toMatch(/rate_key\s+TEXT\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/attempt_count\s+INTEGER\s+NOT\s+NULL/i);
  });

  test('the shared schema contract includes the Phase 2 additions', () => {
    expect(EXPECTED_SCHEMA.app_users).toContain('role');
    expect(EXPECTED_SCHEMA.scan_jobs).toContain('initiator_user_id');
    expect(EXPECTED_SCHEMA.auth_rate_limits).toEqual([
      'rate_key',
      'window_started_at',
      'attempt_count',
      'updated_at',
    ]);
  });
});

describe('targeted Phase 2 migration runner', () => {
  const runner = readFileSync(join(DB_DIR, 'migrate-phase2.js'), 'utf8');

  test('requires an explicitly approved disposable target', () => {
    expect(runner).toContain('PHASE2_DATABASE_URL');
    expect(runner).toContain('ALLOW_PHASE2_MIGRATION');
    expect(runner).toContain('EXPECTED_PHASE2_HOST');
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

  test('only allows the Phase 2 migration file', () => {
    expect(runner).toContain(MIGRATION_NAME);
  });
});

describe('super-admin bootstrap script', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'bootstrap-super-admin.js'), 'utf8');

  test('requires explicit approval, a dedicated URL, and an expected host', () => {
    expect(script).toContain('BOOTSTRAP_DATABASE_URL');
    expect(script).toContain('ALLOW_SUPER_ADMIN_BOOTSTRAP');
    expect(script).toContain('EXPECTED_BOOTSTRAP_HOST');
    expect(script).toContain('FORBIDDEN_DATABASE_HOST');
  });

  test('never falls back to DATABASE_URL and refuses production', () => {
    expect(script).not.toMatch(/process\.env\.DATABASE_URL/);
    expect(script).toContain('NODE_ENV');
    expect(script).toContain('production');
  });

  test('verifies the Firebase account exists and the email matches', () => {
    expect(script).toContain('getUser');
    expect(script).toContain('getUserByEmail');
    expect(script).toMatch(/email/i);
  });

  test('lets the operator supply the UID by env var or explicit argument', () => {
    expect(script).toContain('SUPER_ADMIN_FIREBASE_UID');
    expect(script).toContain('SUPER_ADMIN_EMAIL');
    expect(script).toContain('--uid=');
    expect(script).toContain('--email=');
  });

  test('writes the role, identity and audit entry in one transaction', () => {
    expect(script).toContain('SUPER_ADMIN_BOOTSTRAPPED');
    expect(script).toContain('user_identities');
    expect(script).toContain('app_users');
    expect(script).toMatch(/BEGIN|transaction/i);
  });

  test('refuses to overwrite or promote an existing account silently', () => {
    expect(script).toMatch(/refus|already|conflict/i);
  });
});

describe('Phase 2 builds on the Phase 1 identity schema', () => {
  const runner = readFileSync(join(DB_DIR, 'migrate-phase2.js'), 'utf8');

  test('the runner refuses to apply Phase 2 without the Phase 1 tables', () => {
    expect(runner).toContain('information_schema.columns');
    expect(runner).toContain('app_users');
    expect(runner).toContain('user_identities');
    expect(runner).toContain('provider_user_id');
    expect(runner).toContain('2026-11-12-add-internal-identity-foundation.sql');
    expect(runner).toMatch(/Phase 1/);
  });

  test('the runner verifies the role check and the owner foreign key', () => {
    expect(runner).toContain('pg_get_constraintdef');
    expect(runner).toMatch(/SUPER_ADMIN/);
    expect(runner).toMatch(/ON DELETE SET NULL/i);
  });

  test('every auth source maps identity through provider_user_id, not provider_uid', () => {
    const sources = [
      'lib/auth/session.ts',
      'lib/auth/repository.ts',
      'lib/auth/provisioning.ts',
      'scripts/bootstrap-super-admin.js',
      'db/expected-schema.js',
    ].map((file) => readFileSync(join(ROOT, file), 'utf8'));

    for (const source of sources) {
      expect(source).toContain('provider_user_id');
      expect(source).not.toContain('provider_uid');
    }
  });

  test('the shared schema contract uses the Phase 1 column names and types', () => {
    expect(EXPECTED_SCHEMA.user_identities).toEqual([
      'identity_id',
      'user_id',
      'provider',
      'provider_user_id',
      'created_at',
      'updated_at',
    ]);
    expect(EXPECTED_SCHEMA.app_users).toContain('role');
    expect(EXPECTED_SCHEMA.user_identities).not.toContain('provider_uid');
  });
});
