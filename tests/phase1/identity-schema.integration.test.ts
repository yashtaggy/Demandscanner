/**
 * Phase 1 database behaviour tests.
 *
 * These run only when PHASE1_TEST_DATABASE_URL points at a DISPOSABLE local or
 * test Postgres database. Without it the suite is skipped, so `npm test` stays
 * offline and never touches the application's configured database.
 *
 * The suite exercises the real migration files in db/ via psql:
 *   1. apply every migration ordered before Phase 1,
 *   2. insert sentinel instrument ids,
 *   3. apply the Phase 1 migration twice (idempotency),
 *   4. apply later migrations (Phase 1.5+) in order,
 *   5. assert constraints, foreign keys, uniqueness and preservation.
 *
 * It never uses DATABASE_URL and never reads .env files.
 */

import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const PHASE1_MIGRATION = '2026-11-12-add-internal-identity-foundation.sql';

const TEST_URL = process.env.PHASE1_TEST_DATABASE_URL?.trim();
const PSQL = process.env.PHASE1_PSQL_BIN?.trim() || 'psql';

jest.setTimeout(120_000);

function run(sql: string): string {
  if (!TEST_URL) throw new Error('PHASE1_TEST_DATABASE_URL is not set');
  return execFileSync(
    PSQL,
    [TEST_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  ).trim();
}

function runFile(filePath: string): void {
  if (!TEST_URL) throw new Error('PHASE1_TEST_DATABASE_URL is not set');
  execFileSync(
    PSQL,
    [TEST_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', filePath],
    { encoding: 'utf8' }
  );
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

const SENTINEL_A = 990000001;
const SENTINEL_B = 990000002;

const describeDb = TEST_URL ? describe : describe.skip;

describeDb('Phase 1 identity schema (disposable database)', () => {
  const runId = randomUUID().replace(/-/g, '');
  const emailBase = `phase1-${runId}`;
  let instrumentsBefore = '';
  let primaryUserId = '';
  let secondaryUserId = '';

  beforeAll(() => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    // Apply migrations in filename order. The Phase 1 migration is applied
    // twice at its own position, and later migrations (Phase 1.5+) follow.
    const beforePhase1 = files.filter((name) => name < PHASE1_MIGRATION);
    const afterPhase1 = files.filter((name) => name > PHASE1_MIGRATION);

    runFile(join(DB_DIR, 'schema.sql'));
    for (const file of beforePhase1) runFile(join(MIGRATIONS_DIR, file));

    run(
      `INSERT INTO instruments (instrument_id, symbol, exchange, company_name, active, source)
       VALUES (${SENTINEL_A}, 'PHASE1A', 'NSE', 'Phase 1 Sentinel A', TRUE, 'test'),
              (${SENTINEL_B}, 'PHASE1B', 'NSE', 'Phase 1 Sentinel B', TRUE, 'test')
       ON CONFLICT (instrument_id) DO NOTHING;`
    );

    instrumentsBefore = run(
      'SELECT COALESCE(string_agg(instrument_id::text, \',\' ORDER BY instrument_id), \'\') FROM instruments;'
    );

    // Apply twice: the second application must be a no-op.
    runFile(join(MIGRATIONS_DIR, PHASE1_MIGRATION));
    runFile(join(MIGRATIONS_DIR, PHASE1_MIGRATION));

    for (const file of afterPhase1) runFile(join(MIGRATIONS_DIR, file));
  });

  afterAll(() => {
    if (!TEST_URL) return;
    run(`DELETE FROM instrument_aliases WHERE provider_instrument_key LIKE '%${runId}%';`);
    run(`DELETE FROM admin_audit_log WHERE action LIKE 'PHASE1_TEST_${runId}%';`);
    run(`DELETE FROM user_identities WHERE provider_user_id LIKE '%${runId}%';`);
    run(`DELETE FROM app_users WHERE lower(email) LIKE '${emailBase}%';`);
  });

  test('migration reapplication is idempotent and preserves every instrument id', () => {
    runFile(join(MIGRATIONS_DIR, PHASE1_MIGRATION));
    const instrumentsAfter = run(
      'SELECT COALESCE(string_agg(instrument_id::text, \',\' ORDER BY instrument_id), \'\') FROM instruments;'
    );
    expect(instrumentsAfter).toBe(instrumentsBefore);
    expect(instrumentsAfter).toContain(String(SENTINEL_A));
    expect(instrumentsAfter).toContain(String(SENTINEL_B));
  });

  test('creates an internal user with a UUID ownership id', () => {
    primaryUserId = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}.One@Example.COM', 'Customer One')
       RETURNING user_id;`
    );
    expect(primaryUserId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    const status = run(`SELECT status FROM app_users WHERE user_id = '${primaryUserId}';`);
    expect(status).toBe('ACTIVE');
  });

  test('email uniqueness is case-insensitive and trimmed', () => {
    const duplicate = expectFailure(
      `INSERT INTO app_users (email) VALUES ('  ${emailBase}.one@example.com  ');`
    );
    expect(duplicate).toMatch(/app_users_email_lower_uq|duplicate key/i);
  });

  test('valid statuses are accepted and invalid statuses are rejected', () => {
    const suspendedId = run(
      `INSERT INTO app_users (email, status)
       VALUES ('${emailBase}.suspended@example.com', 'SUSPENDED')
       RETURNING user_id;`
    );
    expect(run(`SELECT status FROM app_users WHERE user_id = '${suspendedId}';`)).toBe('SUSPENDED');

    const invalid = expectFailure(
      `INSERT INTO app_users (email, status)
       VALUES ('${emailBase}.invalid@example.com', 'PENDING');`
    );
    expect(invalid).toMatch(/app_users_status_chk|check constraint/i);
  });

  test('one Firebase UID maps to exactly one internal user', () => {
    const firebaseUid = `firebase-${runId}`;
    run(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ('${primaryUserId}', 'FIREBASE', '${firebaseUid}');`
    );

    secondaryUserId = run(
      `INSERT INTO app_users (email)
       VALUES ('${emailBase}.two@example.com')
       RETURNING user_id;`
    );

    const duplicate = expectFailure(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ('${secondaryUserId}', 'FIREBASE', '${firebaseUid}');`
    );
    expect(duplicate).toMatch(/user_identities_provider_user_uq|duplicate key/i);

    const mapped = run(
      `SELECT user_id FROM user_identities
       WHERE provider = 'FIREBASE' AND provider_user_id = '${firebaseUid}';`
    );
    expect(mapped).toBe(primaryUserId);
  });

  test('identity foreign keys and provider checks are enforced', () => {
    const missingUser = expectFailure(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ('00000000-0000-4000-8000-000000000000', 'FIREBASE', 'missing-${runId}');`
    );
    expect(missingUser).toMatch(/user_identities_user_id_fkey|foreign key/i);

    const badProvider = expectFailure(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ('${primaryUserId}', 'UPSTOX', 'provider-${runId}');`
    );
    expect(badProvider).toMatch(/user_identities_provider_supported|check constraint/i);
  });

  test('audit records accept structured metadata and reject non-objects', () => {
    const auditId = run(
      `INSERT INTO admin_audit_log
         (actor_user_id, action, target_entity_type, target_entity_id, metadata)
       VALUES
         ('${primaryUserId}', 'PHASE1_TEST_${runId}_CREATE', 'app_user', '${secondaryUserId}',
          '{"source":"integration-test"}'::jsonb)
       RETURNING audit_id;`
    );
    expect(auditId).toMatch(/^[0-9a-f-]{36}$/i);

    const metadata = run(
      `SELECT metadata->>'source' FROM admin_audit_log WHERE audit_id = '${auditId}';`
    );
    expect(metadata).toBe('integration-test');

    // Actor is optional for system-originated actions.
    run(
      `INSERT INTO admin_audit_log (action, target_entity_type, target_entity_id)
       VALUES ('PHASE1_TEST_${runId}_SYSTEM', 'app_user', '${secondaryUserId}');`
    );

    const nonObject = expectFailure(
      `INSERT INTO admin_audit_log (action, target_entity_type, metadata)
       VALUES ('PHASE1_TEST_${runId}_BAD', 'app_user', '[]'::jsonb);`
    );
    expect(nonObject).toMatch(/admin_audit_log_metadata_object|check constraint/i);

    const missingActor = expectFailure(
      `INSERT INTO admin_audit_log (actor_user_id, action, target_entity_type)
       VALUES ('00000000-0000-4000-8000-000000000000', 'PHASE1_TEST_${runId}_FK', 'app_user');`
    );
    expect(missingActor).toMatch(/admin_audit_log_actor_user_id_fkey|foreign key/i);
  });

  test('one instrument can have KITE and UPSTOX aliases', () => {
    run(
      `INSERT INTO instrument_aliases
         (instrument_id, provider, provider_instrument_key, exchange, trading_symbol, instrument_type, segment)
       VALUES
         (${SENTINEL_A}, 'KITE', 'kite-${runId}', 'NSE', 'PHASE1A', 'EQ', 'NSE'),
         (${SENTINEL_A}, 'UPSTOX', 'upstox-${runId}', 'NSE', 'PHASE1A', 'EQ', 'NSE');`
    );

    const count = run(
      `SELECT count(*) FROM instrument_aliases WHERE instrument_id = ${SENTINEL_A}
         AND provider_instrument_key LIKE '%${runId}%';`
    );
    expect(count).toBe('2');
  });

  test('duplicate provider instrument keys are rejected per provider', () => {
    const duplicate = expectFailure(
      `INSERT INTO instrument_aliases
         (instrument_id, provider, provider_instrument_key, exchange, trading_symbol)
       VALUES (${SENTINEL_B}, 'KITE', 'kite-${runId}', 'NSE', 'PHASE1B');`
    );
    expect(duplicate).toMatch(/instrument_aliases_provider_key_uq|duplicate key/i);

    // The same key shape under a different provider is allowed.
    run(
      `INSERT INTO instrument_aliases
         (instrument_id, provider, provider_instrument_key, exchange, trading_symbol)
       VALUES (${SENTINEL_B}, 'UPSTOX', 'upstox-b-${runId}', 'NSE', 'PHASE1B');`
    );
  });

  test('alias foreign key and provider check are enforced', () => {
    const missingInstrument = expectFailure(
      `INSERT INTO instrument_aliases
         (instrument_id, provider, provider_instrument_key, exchange, trading_symbol)
       VALUES (999999999, 'KITE', 'missing-${runId}', 'NSE', 'MISSING');`
    );
    expect(missingInstrument).toMatch(/instrument_aliases_instrument_id_fkey|foreign key/i);

    const badProvider = expectFailure(
      `INSERT INTO instrument_aliases
         (instrument_id, provider, provider_instrument_key, exchange, trading_symbol)
       VALUES (${SENTINEL_A}, 'ZERODHA', 'bad-${runId}', 'NSE', 'PHASE1A');`
    );
    expect(badProvider).toMatch(/instrument_aliases_provider_supported|check constraint/i);
  });

  test('the instruments table keeps its bigint primary key and existing columns', () => {
    expect(
      run(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'instruments'
            AND column_name = 'instrument_id';`
      )
    ).toBe('bigint');

    const columns = run(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'instruments'
        ORDER BY ordinal_position;`
    )
      .split('\n')
      .map((line) => line.trim());
    for (const column of EXPECTED_SCHEMA.instruments) {
      expect(columns).toContain(column);
    }
  });

  test('the full expected schema (including existing scanner tables) is present', () => {
    const rows = run(
      `SELECT table_name || '.' || column_name
         FROM information_schema.columns
        WHERE table_schema = 'public';`
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const present = new Set(rows);

    const missing: string[] = [];
    for (const [table, columns] of Object.entries(
      EXPECTED_SCHEMA as Record<string, string[]>
    )) {
      for (const column of columns) {
        if (!present.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('existing scanner queries still execute against the shared tables', () => {
    // Mirrors the read shape used by /api/scanner/zones without inserting data.
    const rows = run(
      `SELECT count(*)
         FROM zones z
         JOIN instruments i ON i.instrument_id = z.instrument_id;`
    );
    expect(rows).toMatch(/^\d+$/);
    expect(run('SELECT count(*) FROM scan_jobs;')).toMatch(/^\d+$/);
  });
});
