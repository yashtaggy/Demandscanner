/**
 * Phase 3 Live Trade ownership database behaviour.
 *
 * Runs only when PHASE3_TEST_DATABASE_URL points at a DISPOSABLE local/test
 * Postgres database. Without it the suite is skipped. The application's
 * DATABASE_URL is never read.
 *
 * The ordered chain is applied here directly with psql — the broad db:migrate
 * runner is not used and no Neon development database is touched.
 */

import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const PHASE3_MIGRATION = '2026-11-13-live-trade-internal-ownership.sql';

const TEST_URL = process.env.PHASE3_TEST_DATABASE_URL?.trim();
const PSQL = process.env.PHASE3_PSQL_BIN?.trim() || 'psql';

/**
 * Dependency order, not filename order: the identity foundation must exist
 * before Phase 3 references app_users, while the base Live Trade tables only
 * need instruments.
 */
const CHAIN_ORDER = [
  '2024-10-18-add-aggregation-schema.sql',
  '2024-10-18-add-scanner-schema.sql',
  '2024-10-18-v1-intraday-scoring-history.sql',
  '2026-10-20-add-scan-batch-checkpoints.sql',
  '2026-11-12-add-internal-identity-foundation.sql',
  '2026-11-12-add-phase1-5-broker-market-data.sql',
  '2026-11-12-add-phase2-firebase-auth.sql',
  '2026-11-06-add-live-trade.sql',
  '2026-11-09-live-trade-allow-repeat-instruments.sql',
  '2026-11-13-live-trade-internal-ownership.sql',
  '2026-11-13-phase4-subscriptions.sql',
];

jest.setTimeout(120_000);

function run(sql: string): string {
  if (!TEST_URL) throw new Error('PHASE3_TEST_DATABASE_URL is not set');
  return execFileSync(
    PSQL,
    [TEST_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  ).trim();
}

function runFile(filePath: string): void {
  if (!TEST_URL) throw new Error('PHASE3_TEST_DATABASE_URL is not set');
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

describeDb('Phase 3 Live Trade ownership (disposable database)', () => {
  const runId = randomUUID().replace(/-/g, '');
  const emailBase = `phase3-${runId}`;
  const instrumentA = 9_900_001;
  const instrumentB = 9_900_002;
  const sessionHashC = `phase3-${runId}-c`;
  const sessionHashD = `phase3-${runId}-d`;
  const sessionHashE = `phase3-${runId}-e`;

  let userA = '';
  let userB = '';
  let userC = '';
  let userD = '';
  let groupA = '';
  let groupB = '';

  beforeAll(() => {
    runFile(join(DB_DIR, 'schema.sql'));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    // The explicit order must cover every migration in the repository.
    expect([...CHAIN_ORDER].sort()).toEqual(files);
    for (const file of CHAIN_ORDER) runFile(join(MIGRATIONS_DIR, file));

    run(
      `INSERT INTO instruments (instrument_id, symbol, exchange, company_name)
       VALUES (${instrumentA}, 'PH3A', 'NSE', 'Phase 3 A'),
              (${instrumentB}, 'PH3B', 'NSE', 'Phase 3 B')
       ON CONFLICT (instrument_id) DO NOTHING;`
    );

    userA = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-a@example.com', 'Phase 3 A') RETURNING user_id;`
    );
    userB = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-b@example.com', 'Phase 3 B') RETURNING user_id;`
    );
    userC = run(
      `INSERT INTO app_users (email)
       VALUES ('${emailBase}-c@example.com') RETURNING user_id;`
    );
    userD = run(
      `INSERT INTO app_users (email)
       VALUES ('${emailBase}-d@example.com') RETURNING user_id;`
    );

    groupA = run(
      `INSERT INTO live_trade_groups (owner_user_id, name, sort_order)
       VALUES ('${userA}', 'A Momentum', 0) RETURNING group_id;`
    );
    groupB = run(
      `INSERT INTO live_trade_groups (owner_user_id, name, sort_order)
       VALUES ('${userB}', 'B Momentum', 0) RETURNING group_id;`
    );
  });

  afterAll(() => {
    if (!TEST_URL) return;
    run(`DELETE FROM app_users WHERE lower(email) LIKE '${emailBase}%';`);
    run(`DELETE FROM kite_sessions WHERE session_id_hash LIKE 'phase3-${runId}%';`);
    run(`DELETE FROM live_trade_items WHERE instrument_id IN (${instrumentA}, ${instrumentB});`);
    run(`DELETE FROM instruments WHERE instrument_id IN (${instrumentA}, ${instrumentB});`);
  });

  test('reapplying the Phase 3 migration is idempotent', () => {
    runFile(join(MIGRATIONS_DIR, PHASE3_MIGRATION));
    expect(
      run(
        `SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'kite_session_bindings';`
      )
    ).toBe('3');
  });

  test('owner_user_id is UUID NOT NULL on every customer-private table', () => {
    const rows = run(
      `SELECT table_name || ':' || data_type || ':' || is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'owner_user_id'
          AND table_name IN ('live_trade_groups', 'live_trade_items', 'live_trade_quote_state')
        ORDER BY table_name;`
    ).split(/\r?\n/);
    expect(rows).toEqual([
      'live_trade_groups:uuid:NO',
      'live_trade_items:uuid:NO',
      'live_trade_quote_state:uuid:NO',
    ]);
  });

  test('each owner column has an app_users foreign key with cascade', () => {
    const definitions = run(
      `SELECT t.relname || '|' || pg_get_constraintdef(c.oid)
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND c.contype = 'f'
          AND t.relname IN ('live_trade_groups', 'live_trade_items', 'live_trade_quote_state')
        ORDER BY t.relname;`
    ).split(/\r?\n/);

    for (const table of ['live_trade_groups', 'live_trade_items', 'live_trade_quote_state']) {
      const ownerFk = definitions.find((line) =>
        line.startsWith(`${table}|`) &&
        /FOREIGN KEY \(owner_user_id\) REFERENCES app_users\(user_id\) ON DELETE CASCADE/.test(line)
      );
      expect({ table, ownerFk }).toEqual({ table, ownerFk: expect.any(String) });
    }
  });

  test('the composite group foreign key is NO ACTION and keeps repeat instruments possible', () => {
    const composite = run(
      `SELECT pg_get_constraintdef(c.oid)
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'live_trade_items' AND c.conname = 'live_trade_items_group_owner_fk';`
    );
    expect(composite).toMatch(
      /FOREIGN KEY \(group_id, owner_user_id\) REFERENCES live_trade_groups\(group_id, owner_user_id\)/
    );
    expect(composite).not.toMatch(/ON DELETE/i);

    expect(run(`SELECT to_regclass('public.live_trade_items_owner_instrument_uq') IS NULL;`)).toBe('t');
  });

  test('the resulting schema contains every column the application expects', () => {
    for (const table of [
      'live_trade_groups',
      'live_trade_items',
      'live_trade_quote_state',
      'kite_session_bindings',
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

  test('groups and items belong to the internal app user', () => {
    run(
      `INSERT INTO live_trade_items (owner_user_id, instrument_id, group_id)
       VALUES ('${userA}', ${instrumentA}, '${groupA}');`
    );
    expect(
      run(
        `SELECT owner_user_id FROM live_trade_items
          WHERE instrument_id = ${instrumentA} AND group_id = '${groupA}';`
      )
    ).toBe(userA);
    expect(
      run(`SELECT owner_user_id FROM live_trade_groups WHERE group_id = '${groupA}';`)
    ).toBe(userA);
  });

  test('one owner can record repeated entries for the same instrument', () => {
    run(
      `INSERT INTO live_trade_items (owner_user_id, instrument_id, group_id)
       VALUES ('${userA}', ${instrumentA}, '${groupA}');`
    );
    expect(
      run(
        `SELECT COUNT(*) FROM live_trade_items
          WHERE owner_user_id = '${userA}' AND instrument_id = ${instrumentA};`
      )
    ).toBe('2');
  });

  test('an item cannot reference another owner group', () => {
    const failure = expectFailure(
      `INSERT INTO live_trade_items (owner_user_id, instrument_id, group_id)
       VALUES ('${userB}', ${instrumentB}, '${groupA}');`
    );
    expect(failure).toMatch(/live_trade_items_group_owner_fk|foreign key/i);
  });

  test('owner values must be UUIDs and must exist in app_users', () => {
    const notUuid = expectFailure(
      `INSERT INTO live_trade_groups (owner_user_id, name)
       VALUES ('ZP0001', 'Legacy');`
    );
    expect(notUuid).toMatch(/invalid input syntax for type uuid/i);

    const nullOwner = expectFailure(
      `INSERT INTO live_trade_groups (owner_user_id, name)
       VALUES (NULL, 'No owner');`
    );
    expect(nullOwner).toMatch(/not-null|NOT NULL|violates/i);

    const unknownOwner = expectFailure(
      `INSERT INTO live_trade_groups (owner_user_id, name)
       VALUES ('${randomUUID()}', 'Unknown');`
    );
    expect(unknownOwner).toMatch(/live_trade_groups_owner_fk|foreign key/i);
  });

  test('two customers cannot read or mutate each other rows', () => {
    run(
      `INSERT INTO live_trade_items (owner_user_id, instrument_id, group_id)
       VALUES ('${userB}', ${instrumentB}, '${groupB}');`
    );

    expect(
      run(
        `SELECT COUNT(*) FROM live_trade_groups WHERE owner_user_id = '${userA}';`
      )
    ).toBe('1');
    expect(
      run(
        `SELECT COUNT(*) FROM live_trade_groups WHERE owner_user_id = '${userB}';`
      )
    ).toBe('1');
    expect(
      run(
        `SELECT COUNT(*) FROM live_trade_items WHERE owner_user_id = '${userA}'
            AND instrument_id = ${instrumentB};`
      )
    ).toBe('0');
    expect(
      run(
        `SELECT COUNT(*) FROM live_trade_items WHERE owner_user_id = '${userB}'
            AND instrument_id = ${instrumentA};`
      )
    ).toBe('0');

    // An owner-scoped update leaves the other customer untouched.
    run(
      `UPDATE live_trade_items SET notes = 'A private note'
        WHERE owner_user_id = '${userA}' AND instrument_id = ${instrumentB};`
    );
    expect(
      run(
        `SELECT COUNT(*) FROM live_trade_items
          WHERE owner_user_id = '${userB}' AND notes = 'A private note';`
      )
    ).toBe('0');
  });

  test('quote cooldown state is owned per app user', () => {
    run(
      `INSERT INTO live_trade_quote_state (owner_user_id, last_request_at)
       VALUES ('${userA}', NOW() - INTERVAL '10 minutes'),
              ('${userB}', NOW());`
    );
    run(`UPDATE live_trade_quote_state SET last_request_at = NOW() WHERE owner_user_id = '${userA}';`);

    expect(
      run(
        `SELECT COUNT(*) FROM live_trade_quote_state WHERE owner_user_id = '${userA}';`
      )
    ).toBe('1');
    expect(
      run(
        `SELECT last_request_at < NOW() - INTERVAL '5 minutes'
           FROM live_trade_quote_state WHERE owner_user_id = '${userB}';`
      )
    ).toBe('f');

    const duplicate = expectFailure(
      `INSERT INTO live_trade_quote_state (owner_user_id, last_request_at)
       VALUES ('${userA}', NOW());`
    );
    expect(duplicate).toMatch(/live_trade_quote_state_pkey|duplicate key/i);

    const unknownOwner = expectFailure(
      `INSERT INTO live_trade_quote_state (owner_user_id, last_request_at)
       VALUES ('${randomUUID()}', NOW());`
    );
    expect(unknownOwner).toMatch(/live_trade_quote_state_owner_fk|foreign key/i);
  });

  test('kite_session_bindings links one broker session to one app user', () => {
    run(
      `INSERT INTO kite_sessions (
         session_id_hash, encrypted_access_token, user_id, user_name, email,
         login_time, expires_at
       ) VALUES (
         '${sessionHashC}', 'encrypted-token', 'ZP0001', 'Owner', 'owner@example.com',
         NOW(), NOW() + INTERVAL '1 day'
       );`
    );
    run(
      `INSERT INTO kite_session_bindings (session_id_hash, app_user_id)
       VALUES ('${sessionHashC}', '${userC}');`
    );

    expect(
      run(
        `SELECT app_user_id FROM kite_session_bindings WHERE session_id_hash = '${sessionHashC}';`
      )
    ).toBe(userC);

    const duplicate = expectFailure(
      `INSERT INTO kite_session_bindings (session_id_hash, app_user_id)
       VALUES ('${sessionHashC}', '${userD}');`
    );
    expect(duplicate).toMatch(/kite_session_bindings_pkey|duplicate key/i);

    const unknownUser = expectFailure(
      `INSERT INTO kite_sessions (
         session_id_hash, encrypted_access_token, user_id, user_name, email,
         login_time, expires_at
       ) VALUES (
         '${sessionHashE}', 'encrypted-token', 'ZP0003', 'Owner E', 'e@example.com',
         NOW(), NOW() + INTERVAL '1 day'
       );
       INSERT INTO kite_session_bindings (session_id_hash, app_user_id)
       VALUES ('${sessionHashE}', '${randomUUID()}');`
    );
    expect(unknownUser).toMatch(/kite_session_bindings_app_user_id_fkey|foreign key/i);

    const unknownSession = expectFailure(
      `INSERT INTO kite_session_bindings (session_id_hash, app_user_id)
       VALUES ('missing-${runId}', '${userD}');`
    );
    expect(unknownSession).toMatch(/kite_session_bindings_session_id_hash_fkey|foreign key/i);
  });

  test('deleting an app user cascades their Live Trade rows and broker binding', () => {
    run(
      `INSERT INTO live_trade_groups (owner_user_id, name)
       VALUES ('${userC}', 'C Momentum');`
    );
    run(
      `INSERT INTO live_trade_items (owner_user_id, instrument_id)
       VALUES ('${userC}', ${instrumentB});`
    );
    run(
      `INSERT INTO live_trade_quote_state (owner_user_id, last_request_at)
       VALUES ('${userC}', NOW());`
    );

    run(`DELETE FROM app_users WHERE user_id = '${userC}';`);

    expect(run(`SELECT COUNT(*) FROM live_trade_groups WHERE owner_user_id = '${userC}';`)).toBe('0');
    expect(run(`SELECT COUNT(*) FROM live_trade_items WHERE owner_user_id = '${userC}';`)).toBe('0');
    expect(
      run(`SELECT COUNT(*) FROM live_trade_quote_state WHERE owner_user_id = '${userC}';`)
    ).toBe('0');
    expect(
      run(
        `SELECT COUNT(*) FROM kite_session_bindings WHERE session_id_hash = '${sessionHashC}';`
      )
    ).toBe('0');
  });

  test('deleting a broker session cascades only its binding', () => {
    run(
      `INSERT INTO kite_sessions (
         session_id_hash, encrypted_access_token, user_id, user_name, email,
         login_time, expires_at
       ) VALUES (
         '${sessionHashD}', 'encrypted-token', 'ZP0002', 'Owner D', 'd@example.com',
         NOW(), NOW() + INTERVAL '1 day'
       );`
    );
    run(
      `INSERT INTO kite_session_bindings (session_id_hash, app_user_id)
       VALUES ('${sessionHashD}', '${userD}');`
    );
    run(`DELETE FROM kite_sessions WHERE session_id_hash = '${sessionHashD}';`);

    expect(
      run(
        `SELECT COUNT(*) FROM kite_session_bindings WHERE session_id_hash = '${sessionHashD}';`
      )
    ).toBe('0');
    expect(run(`SELECT COUNT(*) FROM app_users WHERE user_id = '${userD}';`)).toBe('1');
  });
});
