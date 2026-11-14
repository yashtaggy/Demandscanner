/**
 * Signals migration contract (static).
 *
 * No database is contacted. Behaviour against a disposable Postgres lives in
 * tests/signals and is skipped unless SIGNALS_TEST_DATABASE_URL is set.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { splitStatements } = require(join(__dirname, '..', '..', 'db', 'sql-statements'));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const ROOT = join(__dirname, '..', '..');
const DB_DIR = join(ROOT, 'db');
const MIGRATION_NAME = '2026-11-14-add-signals.sql';
const MIGRATION_PATH = join(DB_DIR, 'migrations', MIGRATION_NAME);
const FINGERPRINT_MIGRATION_NAME =
  '2026-11-15-add-signals-idempotency-fingerprint.sql';
const FINGERPRINT_MIGRATION_PATH = join(
  DB_DIR,
  'migrations',
  FINGERPRINT_MIGRATION_NAME
);
const RUNNER_PATH = join(DB_DIR, 'migrate-signals.js');

const statements: string[] = splitStatements(readFileSync(MIGRATION_PATH, 'utf8'));
const ddl = statements.join('\n');
const fingerprintStatements: string[] = splitStatements(
  readFileSync(FINGERPRINT_MIGRATION_PATH, 'utf8')
);

const SIGNALS_COLUMNS = [
  'signal_id',
  'message',
  'created_by',
  'created_at',
  'published_at',
  'status',
  'idempotency_key',
];

const RECIPIENT_COLUMNS = [
  'recipient_id',
  'signal_id',
  'user_id',
  'email_address',
  'read_at',
  'email_status',
  'email_attempts',
  'email_next_attempt_at',
  'email_last_attempt_at',
  'email_sent_at',
  'email_error',
  'email_lease_owner',
  'email_lease_expires_at',
  'created_at',
];

const ATTEMPT_COLUMNS = [
  'attempt_id',
  'recipient_id',
  'attempted_at',
  'outcome',
  'error_code',
  'error_message',
];

function statementMatching(pattern: RegExp): string {
  const found = statements.find((statement) => pattern.test(statement));
  if (!found) throw new Error(`No statement matches ${pattern}`);
  return found;
}

function columnsOf(table: string): string[] {
  const statement = statementMatching(
    new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\s*\\(`, 'i')
  );
  const body = statement.slice(statement.indexOf('(') + 1, statement.lastIndexOf(')'));
  const columns = body
    .split('\n')
    .map((line) => line.trim())
    .map(
      (line) =>
        (line.match(
          /^([a-z_][a-z0-9_]*)\s+(UUID|TEXT|INTEGER|NUMERIC|DATE|TIMESTAMPTZ|BOOLEAN)\b/i
        ) ?? [])[1]
    )
    .filter((name): name is string => Boolean(name));
  return [...new Set(columns)];
}

describe('Signals migration structure', () => {
  test('is the Phase S2 migration file', () => {
    expect(MIGRATION_NAME).toBe('2026-11-14-add-signals.sql');
  });

  test('contains only additive, idempotent CREATE statements', () => {
    expect(statements).toHaveLength(11);
    for (const statement of statements) {
      expect(statement).toMatch(
        /^CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)\s+IF\s+NOT\s+EXISTS\b/i
      );
      expect(statement).not.toMatch(
        /\b(DROP|ALTER|TRUNCATE|INSERT|UPDATE|GRANT|REVOKE|COPY|MERGE|VACUUM)\b|\bDELETE\s+FROM\b/i
      );
    }
  });

  test('does not create a separate email queue table', () => {
    expect(ddl).not.toMatch(/signal_email_queue/i);
  });

  test('creates the three Signals tables with their full columns', () => {
    expect(columnsOf('signals').sort()).toEqual([...SIGNALS_COLUMNS].sort());
    expect(columnsOf('signal_recipients').sort()).toEqual([...RECIPIENT_COLUMNS].sort());
    expect(columnsOf('signal_email_attempts').sort()).toEqual([...ATTEMPT_COLUMNS].sort());
  });

  test('declares database-generated UUID primary keys', () => {
    for (const [table, idColumn] of [
      ['signals', 'signal_id'],
      ['signal_recipients', 'recipient_id'],
      ['signal_email_attempts', 'attempt_id'],
    ]) {
      const statement = statementMatching(
        new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\s*\\(`, 'i')
      );
      expect(statement).toMatch(
        new RegExp(`${idColumn}\\s+UUID\\s+PRIMARY KEY\\s+DEFAULT gen_random_uuid\\(\\)`, 'i')
      );
    }
  });

  test('foreign keys use the approved ON DELETE behaviour', () => {
    expect(ddl).toMatch(
      /FOREIGN KEY \(created_by\)\s+REFERENCES app_users\(user_id\)\s+ON DELETE SET NULL/i
    );
    expect(ddl).toMatch(
      /FOREIGN KEY \(signal_id\)\s+REFERENCES signals\(signal_id\)\s+ON DELETE CASCADE/i
    );
    expect(ddl).toMatch(
      /FOREIGN KEY \(user_id\)\s+REFERENCES app_users\(user_id\)\s+ON DELETE RESTRICT/i
    );
    expect(ddl).toMatch(
      /FOREIGN KEY \(recipient_id\)\s+REFERENCES signal_recipients\(recipient_id\)\s+ON DELETE CASCADE/i
    );
  });

  test('a recipient is unique per signal and user', () => {
    expect(ddl).toMatch(
      /CONSTRAINT signal_recipients_signal_user_uq\s+UNIQUE \(signal_id, user_id\)/i
    );
  });

  test('status columns are constrained to the approved values', () => {
    expect(ddl).toMatch(
      /CONSTRAINT signals_status_chk\s+CHECK \(status IN \('PUBLISHED', 'ARCHIVED'\)\)/i
    );
    expect(ddl).toMatch(
      /CONSTRAINT signal_recipients_email_status_chk\s+CHECK \(\s*email_status IN \(\s*'PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'\s*\)\s*\)/i
    );
    expect(ddl).toMatch(
      /CONSTRAINT signal_email_attempts_outcome_chk\s+CHECK \(outcome IN \('SENT', 'FAILED', 'SKIPPED'\)\)/i
    );
  });

  test('messages are preserved exactly and bounded at 10,000 characters', () => {
    expect(ddl).toMatch(/message\s+TEXT\s+NOT NULL/i);
    expect(ddl).toContain("'[^[:space:]]'");
    expect(ddl).toMatch(
      /CONSTRAINT signals_message_len\s+CHECK \(char_length\(message\) <= 10000\)/i
    );
    expect(ddl).toContain("translate(message, E'\\n\\r\\t', '') !~ '[[:cntrl:]]'");
    // No trimming or normalisation is applied to the stored message.
    expect(ddl).not.toMatch(/(btrim|trim|regexp_replace)\s*\(\s*message/i);
  });

  test('idempotency keys are bounded and unique per creator', () => {
    expect(ddl).toMatch(
      /CONSTRAINT signals_idempotency_len\s+CHECK \(idempotency_key IS NULL OR char_length\(idempotency_key\) BETWEEN 1 AND 128\)/i
    );
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS signals_created_by_idempotency_uq\s+ON signals \(created_by, idempotency_key\)\s+WHERE idempotency_key IS NOT NULL/i
    );
  });

  test('recipient email snapshots are bounded and validated', () => {
    expect(ddl).toMatch(/email_address\s+TEXT\s+NOT NULL/i);
    expect(ddl).toMatch(
      /CONSTRAINT signal_recipients_email_len\s+CHECK \(char_length\(email_address\) <= 320\)/i
    );
    expect(ddl).toMatch(/CONSTRAINT signal_recipients_email_chk/i);
  });

  test('creates the inbox, delivery and outbox indexes', () => {
    const required: Array<[string, RegExp]> = [
      [
        'signal_recipients_user_created_idx',
        /CREATE INDEX IF NOT EXISTS signal_recipients_user_created_idx\s+ON signal_recipients \(user_id, created_at DESC\)/,
      ],
      [
        'signal_recipients_unread_idx',
        /CREATE INDEX IF NOT EXISTS signal_recipients_unread_idx\s+ON signal_recipients \(user_id, created_at DESC\)\s+WHERE read_at IS NULL/,
      ],
      [
        'signal_recipients_signal_idx',
        /CREATE INDEX IF NOT EXISTS signal_recipients_signal_idx\s+ON signal_recipients \(signal_id, email_status\)/,
      ],
      [
        'signal_recipients_due_idx',
        /CREATE INDEX IF NOT EXISTS signal_recipients_due_idx\s+ON signal_recipients \(email_next_attempt_at\)\s+WHERE email_status = 'PENDING'/,
      ],
      [
        'signal_recipients_lease_idx',
        /CREATE INDEX IF NOT EXISTS signal_recipients_lease_idx\s+ON signal_recipients \(email_lease_expires_at\)\s+WHERE email_status = 'SENDING'/,
      ],
      [
        'signal_email_attempts_recipient_idx',
        /CREATE INDEX IF NOT EXISTS signal_email_attempts_recipient_idx\s+ON signal_email_attempts \(recipient_id, attempted_at DESC\)/,
      ],
    ];
    for (const [name, pattern] of required) {
      expect({ name, matches: pattern.test(ddl) }).toEqual({ name, matches: true });
    }
  });

  test('delivery attempts store diagnostics only, never message bodies or credentials', () => {
    const statement = statementMatching(
      /CREATE TABLE IF NOT EXISTS signal_email_attempts/i
    );
    expect(statement).not.toMatch(/\b(message|body|password|token|secret|connection)\b/i);
    expect(statement).toMatch(/error_code\s+TEXT/i);
    expect(statement).toMatch(/error_message\s+TEXT/i);
  });

  test('the shared schema contract matches the base migration exactly', () => {
    for (const [table, columns] of [
      ['signal_recipients', RECIPIENT_COLUMNS],
      ['signal_email_attempts', ATTEMPT_COLUMNS],
    ] as Array<[string, string[]]>) {
      expect(EXPECTED_SCHEMA[table]).toEqual(columns);
      expect(columnsOf(table).sort()).toEqual([...columns].sort());
    }

    // signals gets one extra contract column from the fingerprint migration.
    expect(EXPECTED_SCHEMA.signals).toEqual([
      ...SIGNALS_COLUMNS,
      'idempotency_fingerprint',
    ]);
    expect(columnsOf('signals').sort()).toEqual([...SIGNALS_COLUMNS].sort());
  });
});

describe('Signals idempotency fingerprint migration', () => {
  const statement = fingerprintStatements.join('\n');

  test('is a single additive, idempotent ALTER on signals', () => {
    expect(fingerprintStatements).toHaveLength(1);
    expect(statement).toMatch(
      /^ALTER\s+TABLE\s+signals\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+idempotency_fingerprint\s+TEXT\b/i
    );
    expect(statement).not.toMatch(
      /\b(DROP|TRUNCATE|INSERT|UPDATE|GRANT|REVOKE|COPY|MERGE|VACUUM)\b|\bDELETE\s+FROM\b/i
    );
  });

  test('constrains the stored digest to lowercase SHA-256 hex', () => {
    expect(statement).toMatch(
      /CONSTRAINT\s+signals_idempotency_fingerprint_chk\s+CHECK\s*\(/i
    );
    expect(statement).toContain("idempotency_fingerprint IS NULL OR");
    expect(statement).toContain("'^[0-9a-f]{64}$'");
  });

  test('does not touch the idempotency unique index or any other object', () => {
    expect(statement).not.toMatch(/signals_created_by_idempotency_uq/i);
    expect(statement).not.toMatch(/\b(CREATE|DROP|RENAME)\b/i);
    expect(statement.match(/^ALTER\s+TABLE/gi)).toHaveLength(1);
    expect(statement).not.toMatch(/\bADD\s+CONSTRAINT\b/i);
    expect(statement).not.toMatch(/\bSET\s+(NOT\s+NULL|DEFAULT)\b/i);
  });
});

describe('Signals migration runner', () => {
  const runner = readFileSync(RUNNER_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//');
      return index === -1 ? line : line.slice(0, index);
    })
    .join('\n');

  test('is targeted and requires explicit approval', () => {
    expect(runner).toContain(MIGRATION_NAME);
    expect(runner).toContain(FINGERPRINT_MIGRATION_NAME);
    expect(runner).toContain('SIGNALS_DATABASE_URL');
    expect(runner).toContain('ALLOW_SIGNALS_MIGRATION');
    expect(runner).toContain('EXPECTED_SIGNALS_HOST');
    expect(runner).toContain('FORBIDDEN_DATABASE_HOST');
    expect(runner).not.toContain('readdir');
    expect(runner).not.toContain('migrate.js');
  });

  test('applies the fingerprint migration after the base migration', () => {
    expect(runner).toContain('const MIGRATIONS = [');
    expect(runner).toContain('FINGERPRINT_MIGRATION_SPEC');
    // The base file stays CREATE-only; the only ALTER shape is allow-listed.
    expect(runner).toContain('FORBIDDEN_KEYWORDS');
    expect(runner).toContain('FORBIDDEN_ADDITIVE_KEYWORDS');
    expect(runner).toMatch(
      /ALTER\\s\+TABLE\\s\+signals\\s\+ADD\\s\+COLUMN\\s\+IF\\s\+NOT\\s\+EXISTS\\s\+idempotency_fingerprint/
    );
    expect(runner).toContain('onlyFingerprintMissing');
    expect(runner).toContain('signals.signals_idempotency_fingerprint_chk');
  });

  test('never reads or falls back to the application connection string', () => {
    expect(runner).not.toMatch(/process\.env\.DATABASE_URL\b/);
    expect(runner).not.toContain('dotenv');
    expect(runner).not.toContain('.env.local');
  });

  test('requires the authorized Neon host, database, direct endpoint and SSL', () => {
    expect(runner).toContain('ep-quiet-resonance-bdscyunv.c-8.us-east-2.aws.neon.tech');
    expect(runner).toContain("'neondb'");
    expect(runner).toContain('target.isNeon');
    expect(runner).toContain('target.pooled');
    expect(runner).toContain('target.host !== AUTHORIZED_HOST');
    expect(runner).toContain('target.database !== AUTHORIZED_DATABASE');
    expect(runner).toContain('SSL_MODES');
  });

  test('refuses production and forbidden targets before connecting', () => {
    expect(runner).toContain("NODE_ENV === 'production'");
    expect(runner).toContain('FORBIDDEN_DATABASE_HOST');
  });

  test('is idempotent and fails closed on an unexpected partial schema', () => {
    expect(runner).toContain('before.complete');
    expect(runner).toContain('before.pristine');
    expect(runner).toContain('partially applied');
    expect(runner).toContain('will not be modified');
    expect(runner).toContain('migration.allowed');
    expect(runner).toContain('FORBIDDEN_KEYWORDS');
  });
});
