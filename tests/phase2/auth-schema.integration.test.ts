/**
 * Phase 2 database behaviour tests.
 *
 * Runs only when PHASE2_TEST_DATABASE_URL points at a DISPOSABLE local/test
 * Postgres database. Without it the suite is skipped. The application's
 * DATABASE_URL is never read.
 */

import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const PHASE2_MIGRATION = '2026-11-12-add-phase2-firebase-auth.sql';

const TEST_URL = process.env.PHASE2_TEST_DATABASE_URL?.trim();
const PSQL = process.env.PHASE2_PSQL_BIN?.trim() || 'psql';

jest.setTimeout(120_000);

function run(sql: string): string {
  if (!TEST_URL) throw new Error('PHASE2_TEST_DATABASE_URL is not set');
  return execFileSync(
    PSQL,
    [TEST_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  ).trim();
}

function runFile(filePath: string): void {
  if (!TEST_URL) throw new Error('PHASE2_TEST_DATABASE_URL is not set');
  execFileSync(PSQL, [TEST_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', filePath], {
    encoding: 'utf8',
  });
}

function failureMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (stderr) return String(stderr);
  }
  return error instanceof Error ? error.message : String(error);
}

function expectFailure(sql: string): string {
  try {
    run(sql);
  } catch (error) {
    return failureMessage(error);
  }
  throw new Error('Expected the statement to fail, but it succeeded.');
}

const describeDb = TEST_URL ? describe : describe.skip;

describeDb('Phase 2 auth schema (disposable database)', () => {
  const runId = randomUUID().replace(/-/g, '');
  const emailBase = `phase2-${runId}`;
  const jobId = randomUUID();
  let userId = '';
  let configId = '';
  let throwawayJobId = '';

  beforeAll(() => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const beforePhase2 = files.filter((name) => name < PHASE2_MIGRATION);

    runFile(join(DB_DIR, 'schema.sql'));
    for (const file of beforePhase2) runFile(join(MIGRATIONS_DIR, file));

    // Applied twice: the second application must be a no-op.
    runFile(join(MIGRATIONS_DIR, PHASE2_MIGRATION));
    runFile(join(MIGRATIONS_DIR, PHASE2_MIGRATION));

    configId = run(
      `INSERT INTO scanner_configs (version, config_json)
       VALUES (999999, '{}'::jsonb) RETURNING config_id;`
    );
    run(
      `INSERT INTO scan_jobs (job_id, started_at, status, progress_percent, config_id)
       VALUES ('${jobId}', NOW(), 'PENDING', 0, '${configId}');`
    );
  });

  afterAll(() => {
    if (!TEST_URL) return;
    run(`DELETE FROM scan_jobs WHERE job_id IN ('${jobId}', '${throwawayJobId}');`);
    run(`DELETE FROM scanner_configs WHERE config_id = '${configId}';`);
    run(`DELETE FROM auth_rate_limits WHERE rate_key LIKE '%${runId}%';`);
    run(`DELETE FROM user_identities WHERE provider_user_id LIKE '%${runId}%';`);
    run(`DELETE FROM app_users WHERE lower(email) LIKE '${emailBase}%';`);
  });

  test('reapplying the migration is idempotent', () => {
    runFile(join(MIGRATIONS_DIR, PHASE2_MIGRATION));
    expect(run("SELECT COUNT(*) FROM auth_rate_limits WHERE rate_key = 'never-used';")).toBe('0');
  });

  test('the resulting schema contains every column the application expects', () => {
    for (const table of [
      'app_users',
      'user_identities',
      'admin_audit_log',
      'scan_jobs',
      'auth_rate_limits',
    ]) {
      const actual = run(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table}';`
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const missing = (EXPECTED_SCHEMA as Record<string, string[]>)[table].filter(
        (column) => !actual.includes(column)
      );
      expect({ table, missing }).toEqual({ table, missing: [] });
    }
  });

  test('identity and ownership columns have the expected types and role default', () => {
    const typeOf = (table: string, column: string) =>
      run(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table}'
            AND column_name = '${column}';`
      );

    expect(typeOf('app_users', 'user_id')).toBe('uuid');
    expect(typeOf('app_users', 'email')).toBe('text');
    expect(typeOf('app_users', 'role')).toBe('text');
    expect(typeOf('user_identities', 'provider_user_id')).toBe('text');
    expect(typeOf('scan_jobs', 'initiator_user_id')).toBe('uuid');
    expect(typeOf('auth_rate_limits', 'attempt_count')).toBe('integer');
    expect(
      run(
        `SELECT column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'app_users'
            AND column_name = 'role';`
      )
    ).toContain('CUSTOMER');
  });

  test('existing and new users default to CUSTOMER', () => {
    userId = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}@example.com', 'Phase 2 User')
       RETURNING user_id;`
    );
    expect(run(`SELECT role FROM app_users WHERE user_id = '${userId}';`)).toBe('CUSTOMER');
  });

  test('only the three roles are accepted', () => {
    const invalid = expectFailure(
      `INSERT INTO app_users (email, role)
       VALUES ('${emailBase}.bad@example.com', 'OWNER');`
    );
    expect(invalid).toMatch(/app_users_role_check|check constraint/i);

    run(`UPDATE app_users SET role = 'ADMIN' WHERE user_id = '${userId}';`);
    expect(run(`SELECT role FROM app_users WHERE user_id = '${userId}';`)).toBe('ADMIN');
  });

  test('scan_jobs gains a nullable app-user owner', () => {
    expect(
      run(`SELECT COALESCE(initiator_user_id::text, 'NULL') FROM scan_jobs WHERE job_id = '${jobId}';`)
    ).toBe('NULL');

    run(`UPDATE scan_jobs SET initiator_user_id = '${userId}' WHERE job_id = '${jobId}';`);
    expect(
      run(`SELECT initiator_user_id FROM scan_jobs WHERE job_id = '${jobId}';`)
    ).toBe(userId);
  });

  test('deleting the owner keeps the job and nulls the owner (no cascade delete)', () => {
    const throwaway = run(
      `INSERT INTO app_users (email) VALUES ('${emailBase}.throwaway@example.com') RETURNING user_id;`
    );
    throwawayJobId = randomUUID();
    run(
      `INSERT INTO scan_jobs (job_id, started_at, status, progress_percent, config_id, initiator_user_id)
       VALUES ('${throwawayJobId}', NOW(), 'PENDING', 0, '${configId}', '${throwaway}');`
    );
    run(`DELETE FROM app_users WHERE user_id = '${throwaway}';`);
    expect(
      run(
        `SELECT COALESCE(initiator_user_id::text, 'NULL')
           FROM scan_jobs WHERE job_id = '${throwawayJobId}';`
      )
    ).toBe('NULL');
  });

  test('the Firebase UID mapping is unique and cascades with its app user', () => {
    const identityUser = run(
      `INSERT INTO app_users (email)
       VALUES ('${emailBase}.identity@example.com')
       RETURNING user_id;`
    );
    const providerUid = `uid-${runId}`;

    run(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ('${identityUser}', 'FIREBASE', '${providerUid}');`
    );
    const duplicate = expectFailure(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ('${identityUser}', 'FIREBASE', '${providerUid}');`
    );
    expect(duplicate).toMatch(/user_identities_provider_user_uq|duplicate key/i);

    run(`DELETE FROM app_users WHERE user_id = '${identityUser}';`);
    expect(
      run(`SELECT COUNT(*) FROM user_identities WHERE user_id = '${identityUser}';`)
    ).toBe('0');
  });

  test('scan_jobs rejects an initiator that is not an app user', () => {
    const invalid = expectFailure(
      `INSERT INTO scan_jobs (
         job_id, started_at, status, progress_percent, config_id, initiator_user_id
       ) VALUES (
         '${randomUUID()}', NOW(), 'PENDING', 0, '${configId}', '${randomUUID()}'
       );`
    );
    expect(invalid).toMatch(/scan_jobs_initiator_user_id_fkey|foreign key/i);
  });

  test('auth_rate_limits upserts a counter and rejects duplicates and negatives', () => {
    const key = `session:test:${runId}`;
    run(
      `INSERT INTO auth_rate_limits (rate_key, window_started_at, attempt_count)
       VALUES ('${key}', NOW(), 1);`
    );
    run(
      `UPDATE auth_rate_limits SET attempt_count = attempt_count + 1, updated_at = NOW()
        WHERE rate_key = '${key}';`
    );
    expect(run(`SELECT attempt_count FROM auth_rate_limits WHERE rate_key = '${key}';`)).toBe('2');

    const duplicate = expectFailure(
      `INSERT INTO auth_rate_limits (rate_key, window_started_at, attempt_count)
       VALUES ('${key}', NOW(), 1);`
    );
    expect(duplicate).toMatch(/auth_rate_limits_pkey|duplicate key/i);

    const negative = expectFailure(
      `UPDATE auth_rate_limits SET attempt_count = -1 WHERE rate_key = '${key}';`
    );
    expect(negative).toMatch(/auth_rate_limits_attempt_count_check|check constraint/i);
  });
});
