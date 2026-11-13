/**
 * Phase 1.5 database behaviour tests.
 *
 * Runs only when PHASE15_TEST_DATABASE_URL points at a DISPOSABLE local/test
 * Postgres database. Without it the suite is skipped, so `npm test` stays
 * offline and never touches the application's configured database.
 *
 * It applies schema.sql and every migration in filename order through psql,
 * then verifies the Phase 1.5 contract against the real database:
 *   * additive/idempotent migration,
 *   * system-only credential table with no owner column,
 *   * unique SYSTEM connection per provider,
 *   * OAuth-state and lease constraints,
 *   * stale-lease recovery through the same atomic upsert the app uses,
 *   * AES-256-GCM AAD binding survives a real storage round-trip.
 */

import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

process.env.KITE_TOKEN_ENCRYPTION_KEY =
  process.env.KITE_TOKEN_ENCRYPTION_KEY ?? '0123456789abcdef'.repeat(4);

import { decryptWithAad, encryptWithAad } from '@/lib/crypto';
import { marketDataAad } from '@/lib/market-data/credentials';

const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const PHASE15_MIGRATION = '2026-11-12-add-phase1-5-broker-market-data.sql';

const TEST_URL = process.env.PHASE15_TEST_DATABASE_URL?.trim();
const PSQL = process.env.PHASE15_PSQL_BIN?.trim() || process.env.PHASE1_PSQL_BIN?.trim() || 'psql';

jest.setTimeout(120_000);

function run(sql: string): string {
  if (!TEST_URL) throw new Error('PHASE15_TEST_DATABASE_URL is not set');
  return execFileSync(
    PSQL,
    [TEST_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  ).trim();
}

function runFile(filePath: string): void {
  if (!TEST_URL) throw new Error('PHASE15_TEST_DATABASE_URL is not set');
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

describeDb('Phase 1.5 market-data schema (disposable database)', () => {
  const runId = randomUUID().replace(/-/g, '');
  const connectionA = randomUUID();
  const connectionB = randomUUID();
  const lockName = `test:ingestion:${runId}`;
  const stateHash = runId.padEnd(64, '0').slice(0, 64);

  beforeAll(() => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    runFile(join(DB_DIR, 'schema.sql'));
    for (const file of files) runFile(join(MIGRATIONS_DIR, file));
    // The Phase 1.5 file must be safe to re-apply.
    runFile(join(MIGRATIONS_DIR, PHASE15_MIGRATION));
  });

  afterAll(() => {
    if (!TEST_URL) return;
    run(`DELETE FROM market_data_connections WHERE connection_id IN ('${connectionA}', '${connectionB}');`);
    run(`DELETE FROM market_data_oauth_states WHERE state_hash = '${stateHash}';`);
    run(`DELETE FROM global_ingestion_locks WHERE lock_name = '${lockName}';`);
  });

  test('the Phase 1.5 tables and columns match the contract', () => {
    const rows = run(
      `SELECT table_name || '.' || column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('market_data_connections', 'market_data_oauth_states', 'global_ingestion_locks');`
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const present = new Set(rows);

    for (const table of [
      'market_data_connections',
      'market_data_oauth_states',
      'global_ingestion_locks',
    ]) {
      for (const column of EXPECTED_SCHEMA[table]) {
        expect(present.has(`${table}.${column}`)).toBe(true);
      }
    }
    expect(present.has('market_data_connections.user_id')).toBe(false);
  });

  test('system connections accept only supported providers, SYSTEM designation and valid status', () => {
    const insert = (provider: string, designation = 'SYSTEM', status = 'ACTIVE') =>
      `INSERT INTO market_data_connections
         (connection_id, provider, designation, encrypted_access_token, status)
       VALUES ('${randomUUID()}', '${provider}', '${designation}', 'ciphertext', '${status}');`;

    expect(expectFailure(insert('ZERODHA'))).toMatch(
      /market_data_connections_provider_supported|check constraint/i
    );
    expect(expectFailure(insert('KITE', 'CUSTOMER'))).toMatch(
      /market_data_connections_designation_system|check constraint/i
    );
    expect(expectFailure(insert('KITE', 'SYSTEM', 'PENDING'))).toMatch(
      /market_data_connections_status_chk|check constraint/i
    );
    expect(expectFailure(
      `INSERT INTO market_data_connections (provider, encrypted_access_token)
       VALUES ('KITE', '   ');`
    )).toMatch(/market_data_connections_access_token_not_blank|check constraint/i);
    expect(expectFailure(
      `INSERT INTO market_data_connections (provider, encrypted_access_token, provider_metadata)
       VALUES ('KITE', 'ciphertext', '[]'::jsonb);`
    )).toMatch(/market_data_connections_metadata_object|check constraint/i);
  });

  test('one SYSTEM connection per provider is enforced', () => {
    run(
      `INSERT INTO market_data_connections
         (connection_id, provider, designation, encrypted_access_token)
       VALUES ('${connectionA}', 'KITE', 'SYSTEM', 'cipher-a');`
    );

    expect(
      expectFailure(
        `INSERT INTO market_data_connections
           (connection_id, provider, designation, encrypted_access_token)
         VALUES ('${connectionB}', 'KITE', 'SYSTEM', 'cipher-b');`
      )
    ).toMatch(/market_data_connections_designation_provider_uq|duplicate key/i);

    run(`DELETE FROM market_data_connections WHERE connection_id = '${connectionA}';`);
  });

  test('OAuth state requires a 64-character hash and a future expiry', () => {
    run(
      `INSERT INTO market_data_oauth_states (state_hash, provider, expires_at)
       VALUES ('${stateHash}', 'KITE', NOW() + INTERVAL '10 minutes');`
    );

    expect(
      expectFailure(
        `INSERT INTO market_data_oauth_states (state_hash, provider, expires_at)
         VALUES ('short', 'KITE', NOW() + INTERVAL '10 minutes');`
      )
    ).toMatch(/market_data_oauth_states_hash_len|check constraint/i);

    expect(
      expectFailure(
        `INSERT INTO market_data_oauth_states (state_hash, provider, expires_at)
         VALUES ('${'b'.repeat(64)}', 'KITE', NOW() - INTERVAL '1 minute');`
      )
    ).toMatch(/market_data_oauth_states_expiry_after_creation|check constraint/i);

    expect(
      expectFailure(
        `INSERT INTO market_data_oauth_states (state_hash, provider, expires_at)
         VALUES ('${'c'.repeat(64)}', 'ZERODHA', NOW() + INTERVAL '10 minutes');`
      )
    ).toMatch(/market_data_oauth_states_provider_supported|check constraint/i);
  });

  test('stale lease recovery uses the same atomic upsert as the application', () => {
    run(
      `INSERT INTO global_ingestion_locks
         (lock_name, lease_owner, acquired_at, heartbeat_at, lease_expires_at, released_at)
       VALUES ('${lockName}', 'owner-a', NOW(), NOW(), NOW() + INTERVAL '2 minutes', NULL);`
    );

    // A live lease cannot be stolen.
    const live = run(
      `INSERT INTO global_ingestion_locks
         (lock_name, lease_owner, acquired_at, heartbeat_at, lease_expires_at, released_at)
       VALUES ('${lockName}', 'owner-b', NOW(), NOW(), NOW() + INTERVAL '2 minutes', NULL)
       ON CONFLICT (lock_name) DO UPDATE SET
         lease_owner = EXCLUDED.lease_owner,
         acquired_at = NOW(),
         heartbeat_at = NOW(),
         lease_expires_at = EXCLUDED.lease_expires_at,
         released_at = NULL
       WHERE global_ingestion_locks.released_at IS NOT NULL
          OR global_ingestion_locks.lease_expires_at < NOW()
       RETURNING lease_owner;`
    );
    expect(live).toBe('');
    expect(
      run(`SELECT lease_owner FROM global_ingestion_locks WHERE lock_name = '${lockName}';`)
    ).toBe('owner-a');

    // Simulate a crashed worker: the lease is in the past and expired. Both
    // timestamps move so the lease_expires_at > acquired_at constraint holds.
    run(
      `UPDATE global_ingestion_locks
          SET acquired_at = NOW() - INTERVAL '3 minutes',
              heartbeat_at = NOW() - INTERVAL '3 minutes',
              lease_expires_at = NOW() - INTERVAL '1 second'
        WHERE lock_name = '${lockName}';`
    );

    const reclaimed = run(
      `INSERT INTO global_ingestion_locks
         (lock_name, lease_owner, acquired_at, heartbeat_at, lease_expires_at, released_at)
       VALUES ('${lockName}', 'owner-b', NOW(), NOW(), NOW() + INTERVAL '2 minutes', NULL)
       ON CONFLICT (lock_name) DO UPDATE SET
         lease_owner = EXCLUDED.lease_owner,
         acquired_at = NOW(),
         heartbeat_at = NOW(),
         lease_expires_at = EXCLUDED.lease_expires_at,
         released_at = NULL
       WHERE global_ingestion_locks.released_at IS NOT NULL
          OR global_ingestion_locks.lease_expires_at < NOW()
       RETURNING lease_owner;`
    );
    expect(reclaimed).toBe('owner-b');

    expect(expectFailure(
      `INSERT INTO global_ingestion_locks (lock_name, lease_owner, lease_expires_at)
       VALUES ('${lockName}', 'owner-c', NOW() - INTERVAL '1 minute');`
    )).toMatch(/global_ingestion_locks_lease_after_acquired|check constraint/i);
  });

  test('AAD-bound ciphertext survives storage and rejects a copied row value', () => {
    const accessToken = `system-token-${runId}`;
    const ciphertext = encryptWithAad(
      accessToken,
      marketDataAad('KITE', connectionA, 'access')
    );

    run(
      `INSERT INTO market_data_connections
         (connection_id, provider, designation, encrypted_access_token)
       VALUES ('${connectionA}', 'KITE', 'SYSTEM', '${ciphertext}');`
    );

    const stored = run(
      `SELECT encrypted_access_token FROM market_data_connections
        WHERE connection_id = '${connectionA}';`
    );
    expect(stored).not.toContain(accessToken);
    expect(decryptWithAad(stored, marketDataAad('KITE', connectionA, 'access'))).toBe(accessToken);

    // Copying the ciphertext into another row does not make it decryptable.
    run(
      `INSERT INTO market_data_connections
         (connection_id, provider, designation, encrypted_access_token)
       VALUES ('${connectionB}', 'UPSTOX', 'SYSTEM', '${ciphertext}');`
    );
    const copied = run(
      `SELECT encrypted_access_token FROM market_data_connections
        WHERE connection_id = '${connectionB}';`
    );
    expect(() =>
      decryptWithAad(copied, marketDataAad('UPSTOX', connectionB, 'access'))
    ).toThrow();
  });
});
