/**
 * Signals schema behaviour (disposable PostgreSQL only).
 *
 * Runs only when SIGNALS_TEST_DATABASE_URL points at a DISPOSABLE local/test
 * Postgres database. Without it the suite is skipped. The application's
 * DATABASE_URL is never read and no Neon development database is touched.
 *
 * The ordered chain is applied here directly with psql — the broad db:migrate
 * runner and db/migrate-signals.js are not used.
 */

import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const SIGNALS_MIGRATION = '2026-11-14-add-signals.sql';
const FINGERPRINT_MIGRATION =
  '2026-11-15-add-signals-idempotency-fingerprint.sql';

const TEST_URL = process.env.SIGNALS_TEST_DATABASE_URL?.trim();
const PSQL = process.env.SIGNALS_PSQL_BIN?.trim() || 'psql';

/** Dependency order, not filename order. */
const BASE_CHAIN = [
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
  if (!TEST_URL) throw new Error('SIGNALS_TEST_DATABASE_URL is not set');
  return execFileSync(
    PSQL,
    [TEST_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  ).trim();
}

function runFile(filePath: string): void {
  if (!TEST_URL) throw new Error('SIGNALS_TEST_DATABASE_URL is not set');
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

describeDb('Signals schema (disposable database)', () => {
  const runId = randomUUID().replace(/-/g, '');
  const emailBase = `signals-${runId}`;
  let creator = '';
  let secondCreator = '';
  let recipientUser = '';
  let otherUser = '';

  function insertSignal(
    messageSql: string,
    createdBy: string,
    idempotencyKey: string | null = null
  ): string {
    return run(
      `INSERT INTO signals (message, created_by, idempotency_key)
       VALUES (${messageSql}, '${createdBy}', ${
         idempotencyKey === null ? 'NULL' : `'${idempotencyKey}'`
       })
       RETURNING signal_id;`
    );
  }

  function addRecipient(signalId: string, userId: string, email: string): string {
    return run(
      `INSERT INTO signal_recipients (signal_id, user_id, email_address)
       VALUES ('${signalId}', '${userId}', '${email}')
       RETURNING recipient_id;`
    );
  }

  beforeAll(() => {
    runFile(join(DB_DIR, 'schema.sql'));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect([...BASE_CHAIN, SIGNALS_MIGRATION, FINGERPRINT_MIGRATION].sort()).toEqual(
      files
    );
    for (const file of BASE_CHAIN) runFile(join(MIGRATIONS_DIR, file));
    runFile(join(MIGRATIONS_DIR, SIGNALS_MIGRATION));
    runFile(join(MIGRATIONS_DIR, FINGERPRINT_MIGRATION));

    creator = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-creator@example.com', 'Signals Creator')
       RETURNING user_id;`
    );
    secondCreator = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-second@example.com', 'Signals Second Creator')
       RETURNING user_id;`
    );
    recipientUser = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-recipient@example.com', 'Signals Recipient')
       RETURNING user_id;`
    );
    otherUser = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-other@example.com', 'Signals Other')
       RETURNING user_id;`
    );
  });

  afterAll(() => {
    if (!TEST_URL) return;
    run(`DELETE FROM signals WHERE message LIKE 'Signals ${runId}%';`);
    run(
      `DELETE FROM signals WHERE created_by IN (
         SELECT user_id FROM app_users WHERE email LIKE '${emailBase}%'
       );`
    );
    run(`DELETE FROM app_users WHERE email LIKE '${emailBase}%';`);
  });

  test('the migration creates exactly the expected tables and columns', () => {
    for (const table of ['signals', 'signal_recipients', 'signal_email_attempts']) {
      const actual = run(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table}';`
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      expect({ table, columns: actual.sort() }).toEqual({
        table,
        columns: [...(EXPECTED_SCHEMA as Record<string, string[]>)[table]].sort(),
      });
    }
  });

  test('reapplying the migration is idempotent', () => {
    const countObjects = () =>
      run(
        `SELECT
           (SELECT count(*) FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
             WHERE t.relname IN ('signals','signal_recipients','signal_email_attempts'))
           || '|' ||
           (SELECT count(*) FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename IN ('signals','signal_recipients','signal_email_attempts'));`
      );

    const before = countObjects();
    runFile(join(MIGRATIONS_DIR, SIGNALS_MIGRATION));
    runFile(join(MIGRATIONS_DIR, FINGERPRINT_MIGRATION));
    runFile(join(MIGRATIONS_DIR, SIGNALS_MIGRATION));
    runFile(join(MIGRATIONS_DIR, FINGERPRINT_MIGRATION));
    expect(countObjects()).toBe(before);
  });

  test('applies the documented defaults', () => {
    const signalId = insertSignal(`'Signals ${runId} defaults'`, creator);
    const recipientId = addRecipient(
      signalId,
      recipientUser,
      `${emailBase}-recipient@example.com`
    );

    const row = run(
      `SELECT s.status || '|' ||
              (s.created_at IS NOT NULL) || '|' ||
              (s.published_at IS NOT NULL) || '|' ||
              r.email_status || '|' ||
              r.email_attempts || '|' ||
              (r.email_next_attempt_at IS NOT NULL) || '|' ||
              (r.read_at IS NULL) || '|' ||
              (r.email_sent_at IS NULL)
         FROM signals s
         JOIN signal_recipients r ON r.signal_id = s.signal_id
        WHERE s.signal_id = '${signalId}' AND r.recipient_id = '${recipientId}';`
    );
    expect(row).toBe('PUBLISHED|true|true|PENDING|0|true|true|true');
  });

  test('enforces the approved foreign-key delete actions', () => {
    const definitions = run(
      `SELECT c.conname || '|' || pg_get_constraintdef(c.oid)
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.contype = 'f'
          AND c.conname IN (
            'signals_created_by_fk',
            'signal_recipients_signal_fk',
            'signal_recipients_user_fk',
            'signal_email_attempts_recipient_fk'
          )
        ORDER BY c.conname;`
    );

    expect(definitions).toContain(
      'signals_created_by_fk|FOREIGN KEY (created_by) REFERENCES app_users(user_id) ON DELETE SET NULL'
    );
    expect(definitions).toContain(
      'signal_recipients_signal_fk|FOREIGN KEY (signal_id) REFERENCES signals(signal_id) ON DELETE CASCADE'
    );
    expect(definitions).toContain(
      'signal_recipients_user_fk|FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT'
    );
    expect(definitions).toContain(
      'signal_email_attempts_recipient_fk|FOREIGN KEY (recipient_id) REFERENCES signal_recipients(recipient_id) ON DELETE CASCADE'
    );
  });

  test('keeps a signal and clears created_by when the publisher is deleted', () => {
    const deletableCreator = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-deletable@example.com', 'Signals Deletable')
       RETURNING user_id;`
    );
    const signalId = insertSignal(
      `'Signals ${runId} publisher deleted'`,
      deletableCreator
    );

    run(`DELETE FROM app_users WHERE user_id = '${deletableCreator}';`);

    expect(
      run(
        `SELECT created_by IS NULL FROM signals WHERE signal_id = '${signalId}';`
      )
    ).toBe('t');
    run(`DELETE FROM signals WHERE signal_id = '${signalId}';`);
  });

  test('rejects invalid email delivery states', () => {
    const signalId = insertSignal(`'Signals ${runId} delivery state'`, creator);
    const recipientId = addRecipient(
      signalId,
      recipientUser,
      `${emailBase}-recipient@example.com`
    );

    const badOutcome = expectFailure(
      `INSERT INTO signal_email_attempts (recipient_id, outcome)
       VALUES ('${recipientId}', 'QUEUED');`
    );
    expect(badOutcome).toMatch(
      /signal_email_attempts_outcome_chk|check constraint/i
    );

    const badLease = expectFailure(
      `UPDATE signal_recipients SET email_status = 'SENDING'
        WHERE recipient_id = '${recipientId}';`
    );
    expect(badLease).toMatch(/signal_recipients_lease_state_chk|check constraint/i);

    const badSent = expectFailure(
      `UPDATE signal_recipients SET email_status = 'SENT'
        WHERE recipient_id = '${recipientId}';`
    );
    expect(badSent).toMatch(/signal_recipients_sent_chk|check constraint/i);
  });

  test('creates the partial indexes with their intended predicates', () => {
    const indexes = run(
      `SELECT indexname || '|' || indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'signals_created_by_idempotency_uq',
            'signal_recipients_unread_idx',
            'signal_recipients_due_idx',
            'signal_recipients_lease_idx'
          );`
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const byName = new Map(
      indexes.map((line) => [line.slice(0, line.indexOf('|')), line])
    );

    expect(byName.get('signals_created_by_idempotency_uq')).toContain(
      'idempotency_key IS NOT NULL'
    );
    expect(byName.get('signal_recipients_unread_idx')).toContain(
      'read_at IS NULL'
    );
    expect(byName.get('signal_recipients_due_idx')).toContain("'PENDING'");
    expect(byName.get('signal_recipients_lease_idx')).toContain("'SENDING'");
  });

  test('preserves the original message exactly, including whitespace and emoji', () => {
    const message = `Signals ${runId}\n\n  line 2\t🔥 ₹ \u{1F680}\nend`;
    // Base64 keeps the Windows psql command line from re-encoding astral
    // characters; the database receives the exact UTF-8 bytes.
    const encoded = Buffer.from(message, 'utf8').toString('base64');
    const signalId = insertSignal(
      `convert_from(decode('${encoded}', 'base64'), 'UTF8')`,
      creator
    );
    const row = run(
      `SELECT md5(message) || '|' || char_length(message)
         FROM signals WHERE signal_id = '${signalId}';`
    );
    const expectedHash = createHash('md5').update(message, 'utf8').digest('hex');
    expect(row).toBe(`${expectedHash}|${[...message].length}`);
  });

  test('accepts exactly 10,000 characters and rejects 10,001', () => {
    expect(() => insertSignal(`repeat('a', 10000)`, creator)).not.toThrow();
    const failure = expectFailure(
      `INSERT INTO signals (message, created_by) VALUES (repeat('a', 10001), '${creator}');`
    );
    expect(failure).toMatch(/signals_message_len|check constraint/i);
  });

  test('rejects blank messages and unsupported control characters', () => {
    const blank = expectFailure(
      `INSERT INTO signals (message, created_by) VALUES (E'  \\n\\t  ', '${creator}');`
    );
    expect(blank).toMatch(/signals_message_not_blank|check constraint/i);

    const control = expectFailure(
      `INSERT INTO signals (message, created_by) VALUES (E'bad \\001 char', '${creator}');`
    );
    expect(control).toMatch(/signals_message_control_chk|check constraint/i);
  });

  test('constrains status values', () => {
    const failure = expectFailure(
      `INSERT INTO signals (message, status, created_by)
       VALUES ('Signals ${runId} status', 'QUEUED', '${creator}');`
    );
    expect(failure).toMatch(/signals_status_chk|check constraint/i);
  });

  test('idempotency keys are unique per creator only', () => {
    const key = `key-${runId}`;
    insertSignal(`'Signals ${runId} idem one'`, creator, key);

    const duplicate = expectFailure(
      `INSERT INTO signals (message, created_by, idempotency_key)
       VALUES ('Signals ${runId} idem two', '${creator}', '${key}');`
    );
    expect(duplicate).toMatch(/signals_created_by_idempotency_uq|duplicate key/i);

    expect(() =>
      insertSignal(`'Signals ${runId} idem three'`, secondCreator, key)
    ).not.toThrow();
  });

  test('stores only a lowercase SHA-256 fingerprint when present', () => {
    const signalId = insertSignal(`'Signals ${runId} fingerprint'`, creator);
    expect(
      run(
        `SELECT idempotency_fingerprint IS NULL FROM signals
          WHERE signal_id = '${signalId}';`
      )
    ).toBe('t');

    const digest = createHash('sha256').update('hello', 'utf8').digest('hex');
    expect(() =>
      run(
        `UPDATE signals SET idempotency_fingerprint = '${digest}'
          WHERE signal_id = '${signalId}';`
      )
    ).not.toThrow();

    const malformed = expectFailure(
      `UPDATE signals SET idempotency_fingerprint = 'not-a-digest'
        WHERE signal_id = '${signalId}';`
    );
    expect(malformed).toMatch(
      /signals_idempotency_fingerprint_chk|check constraint/i
    );
  });

  test('one recipient row per signal and user', () => {
    const signalId = insertSignal(`'Signals ${runId} recipient unique'`, creator);
    addRecipient(signalId, recipientUser, `${emailBase}-recipient@example.com`);

    const duplicate = expectFailure(
      `INSERT INTO signal_recipients (signal_id, user_id, email_address)
       VALUES ('${signalId}', '${recipientUser}', '${emailBase}-recipient@example.com');`
    );
    expect(duplicate).toMatch(/signal_recipients_signal_user_uq|duplicate key/i);
  });

  test('snapshots the recipient email at publication', () => {
    const signalId = insertSignal(`'Signals ${runId} snapshot'`, creator);
    addRecipient(signalId, recipientUser, `${emailBase}-recipient@example.com`);
    run(
      `UPDATE app_users SET email = '${emailBase}-renamed@example.com'
        WHERE user_id = '${recipientUser}';`
    );

    expect(
      run(
        `SELECT email_address FROM signal_recipients WHERE signal_id = '${signalId}';`
      )
    ).toBe(`${emailBase}-recipient@example.com`);

    run(
      `UPDATE app_users SET email = '${emailBase}-recipient@example.com'
        WHERE user_id = '${recipientUser}';`
    );
  });

  test('deleting a signal cascades to recipients and attempts', () => {
    const signalId = insertSignal(`'Signals ${runId} cascade'`, creator);
    const recipientId = addRecipient(
      signalId,
      otherUser,
      `${emailBase}-other@example.com`
    );
    run(
      `INSERT INTO signal_email_attempts (recipient_id, outcome, error_code)
       VALUES ('${recipientId}', 'FAILED', 'SMTP_TIMEOUT');`
    );

    run(`DELETE FROM signals WHERE signal_id = '${signalId}';`);

    expect(
      run(`SELECT count(*) FROM signal_recipients WHERE signal_id = '${signalId}';`)
    ).toBe('0');
    expect(
      run(
        `SELECT count(*) FROM signal_email_attempts WHERE recipient_id = '${recipientId}';`
      )
    ).toBe('0');
  });

  test('deleting a user is RESTRICTed while a recipient row exists', () => {
    const signalId = insertSignal(`'Signals ${runId} restrict'`, creator);
    addRecipient(signalId, otherUser, `${emailBase}-other@example.com`);

    const failure = expectFailure(
      `DELETE FROM app_users WHERE user_id = '${otherUser}';`
    );
    expect(failure).toMatch(/signal_recipients_user_fk|foreign key constraint/i);
  });

  test('creates the inbox, unread, delivery and outbox indexes', () => {
    const indexes = run(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('signals','signal_recipients','signal_email_attempts');`
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(indexes).toEqual(
      expect.arrayContaining([
        'signals_created_by_idempotency_uq',
        'signals_published_idx',
        'signal_recipients_user_created_idx',
        'signal_recipients_unread_idx',
        'signal_recipients_signal_idx',
        'signal_recipients_due_idx',
        'signal_recipients_lease_idx',
        'signal_email_attempts_recipient_idx',
      ])
    );
  });
});
