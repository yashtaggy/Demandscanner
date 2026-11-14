#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node entry point */
/**
 * DemandScan — Signals schema migration runner.
 *
 * Applies these files, in order:
 *
 *   db/migrations/2026-11-14-add-signals.sql
 *   db/migrations/2026-11-15-add-signals-idempotency-fingerprint.sql
 *
 * Safety properties:
 *   * Reads SIGNALS_DATABASE_URL only. It never reads or falls back to
 *     DATABASE_URL, .env.local or any other connection string.
 *   * Requires ALLOW_SIGNALS_MIGRATION=YES as an explicit write approval.
 *   * Requires EXPECTED_SIGNALS_HOST and refuses any host mismatch.
 *   * Requires the single authorized Neon host and database hard-coded below,
 *     so a typo cannot redirect the run.
 *   * Refuses pooled Neon hosts, non-Neon hosts, NODE_ENV=production,
 *     FORBIDDEN_DATABASE_HOST and connections without an explicit SSL mode.
 *   * Accepts only a pristine schema (all three Signals tables absent) or a
 *     fully applied Signals schema. Any partial state is reported and the run
 *     stops without writing; it never repairs or guesses.
 *   * Executes only reviewed statement shapes: CREATE TABLE / CREATE INDEX for
 *     the base file and one exact ALTER TABLE ... ADD COLUMN IF NOT EXISTS for
 *     the fingerprint file. Destructive or data-writing keywords abort first.
 *   * A complete base schema without the fingerprint column is upgraded with
 *     only the fingerprint file; any other partial state stops without writing.
 *   * Prints sanitized target metadata only, never credentials.
 *
 * Usage:
 *   SIGNALS_DATABASE_URL="postgresql://...direct...?sslmode=require" \
 *   EXPECTED_SIGNALS_HOST="ep-quiet-resonance-bdscyunv.c-8.us-east-2.aws.neon.tech" \
 *   FORBIDDEN_DATABASE_HOST="<production-host>" \
 *   ALLOW_SIGNALS_MIGRATION=YES \
 *   npm run db:signals:init
 *
 * Do not point SIGNALS_DATABASE_URL at a production database.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { describeTarget } = require('./target');
const { splitStatements } = require('./sql-statements');
const { EXPECTED_SCHEMA } = require('./expected-schema');

const BASE_MIGRATION = '2026-11-14-add-signals.sql';
const FINGERPRINT_MIGRATION = '2026-11-15-add-signals-idempotency-fingerprint.sql';

const FINGERPRINT_COLUMN = 'signals.idempotency_fingerprint';
const FINGERPRINT_CONSTRAINT = 'signals.signals_idempotency_fingerprint_chk';

const AUTHORIZED_HOST = 'ep-quiet-resonance-bdscyunv.c-8.us-east-2.aws.neon.tech';
const AUTHORIZED_DATABASE = 'neondb';
const SSL_MODES = ['require', 'verify-ca', 'verify-full'];

const TABLES = ['signals', 'signal_recipients', 'signal_email_attempts'];

const REQUIRED_INDEXES = [
  'signals_created_by_idempotency_uq',
  'signals_published_idx',
  'signal_recipients_user_created_idx',
  'signal_recipients_unread_idx',
  'signal_recipients_signal_idx',
  'signal_recipients_due_idx',
  'signal_recipients_lease_idx',
  'signal_email_attempts_recipient_idx',
];

const REQUIRED_CONSTRAINTS = [
  'signals.signals_created_by_fk',
  'signals.signals_message_not_blank',
  'signals.signals_message_len',
  'signals.signals_message_control_chk',
  'signals.signals_status_chk',
  'signals.signals_idempotency_len',
  'signals.signals_idempotency_fingerprint_chk',
  'signal_recipients.signal_recipients_signal_user_uq',
  'signal_recipients.signal_recipients_signal_fk',
  'signal_recipients.signal_recipients_user_fk',
  'signal_recipients.signal_recipients_email_chk',
  'signal_recipients.signal_recipients_email_len',
  'signal_recipients.signal_recipients_email_status_chk',
  'signal_recipients.signal_recipients_attempts_chk',
  'signal_recipients.signal_recipients_error_len',
  'signal_recipients.signal_recipients_lease_owner_len',
  'signal_recipients.signal_recipients_lease_state_chk',
  'signal_recipients.signal_recipients_sent_chk',
  'signal_email_attempts.signal_email_attempts_recipient_fk',
  'signal_email_attempts.signal_email_attempts_outcome_chk',
  'signal_email_attempts.signal_email_attempts_error_code_len',
  'signal_email_attempts.signal_email_attempts_error_message_len',
];

// `ON DELETE CASCADE/RESTRICT/SET NULL` is legitimate foreign-key DDL, so only
// the data-writing form `DELETE FROM` is rejected.
const FORBIDDEN_KEYWORDS =
  /\b(DROP|ALTER|TRUNCATE|GRANT|REVOKE|INSERT|UPDATE|COPY|MERGE|VACUUM)\b|\bDELETE\s+FROM\b/i;

// The fingerprint migration is the only file permitted to ALTER, and only for
// the one exact column shape allow-listed below. Destructive and data-writing
// keywords stay rejected.
const FORBIDDEN_ADDITIVE_KEYWORDS =
  /\b(DROP|TRUNCATE|GRANT|REVOKE|INSERT|UPDATE|COPY|MERGE|VACUUM)\b|\bDELETE\s+FROM\b/i;

const MIGRATIONS = [
  {
    name: BASE_MIGRATION,
    allowed: [
      /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(signals|signal_recipients|signal_email_attempts)\s*\([\s\S]+\)$/i,
      /^CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+signals\b[\s\S]+$/i,
      /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+(signals|signal_recipients|signal_email_attempts)\b[\s\S]+$/i,
    ],
    forbidden: FORBIDDEN_KEYWORDS,
  },
  {
    name: FINGERPRINT_MIGRATION,
    allowed: [
      /^ALTER\s+TABLE\s+signals\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+idempotency_fingerprint\s+TEXT\s+CONSTRAINT\s+signals_idempotency_fingerprint_chk\s+CHECK\s*\([\s\S]+\)$/i,
    ],
    forbidden: FORBIDDEN_ADDITIVE_KEYWORDS,
  },
];

const FINGERPRINT_MIGRATION_SPEC = MIGRATIONS[1];

let executedStatements = 0;
let planCompleted = false;

function stateSummary() {
  if (planCompleted) {
    return 'State: every migration file ran; verification failed afterward.';
  }
  if (executedStatements > 0) {
    return (
      `State: ${executedStatements} statement(s) were executed and committed; ` +
      'later statements did not run.'
    );
  }
  return 'State: no statements were executed.';
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  console.error(stateSummary());
  process.exit(1);
}

function readApprovedTarget() {
  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production.');
  }
  if (process.env.ALLOW_SIGNALS_MIGRATION !== 'YES') {
    fail('Set ALLOW_SIGNALS_MIGRATION=YES to approve this write.');
  }

  const expectedHost = process.env.EXPECTED_SIGNALS_HOST?.trim();
  if (!expectedHost) {
    fail('EXPECTED_SIGNALS_HOST is required (the authorized database host).');
  }
  if (expectedHost !== AUTHORIZED_HOST) {
    fail('EXPECTED_SIGNALS_HOST does not match the authorized database host.');
  }

  const url = process.env.SIGNALS_DATABASE_URL?.trim();
  if (!url) {
    fail(
      'SIGNALS_DATABASE_URL is required. This runner never reads or falls ' +
        'back to the application connection string.'
    );
  }

  const target = describeTarget(url);
  if (!target.isNeon) fail('Target must be a Neon Postgres host.');
  if (target.pooled) fail('Use the direct (non-pooler) Neon host for migrations.');
  if (target.host !== AUTHORIZED_HOST) {
    fail(`Target host "${target.host}" is not the authorized database host.`);
  }
  if (target.database !== AUTHORIZED_DATABASE) {
    fail(`Target database "${target.database}" is not ${AUTHORIZED_DATABASE}.`);
  }
  if (!SSL_MODES.includes(target.sslmode)) {
    fail(
      'SIGNALS_DATABASE_URL must set sslmode=require, verify-ca or ' +
        'verify-full; SSL is required.'
    );
  }

  const forbidden = process.env.FORBIDDEN_DATABASE_HOST?.trim();
  if (forbidden && target.host === forbidden) {
    fail('Target host matches FORBIDDEN_DATABASE_HOST.');
  }

  return { url, target };
}

function loadStatements(migration) {
  const sqlText = readFileSync(
    join(__dirname, 'migrations', migration.name),
    'utf8'
  );
  const statements = splitStatements(sqlText);
  if (statements.length === 0) {
    fail(`Migration file ${migration.name} contains no statements.`);
  }

  for (const [index, statement] of statements.entries()) {
    const allowed = migration.allowed.some((pattern) => pattern.test(statement));
    if (!allowed) {
      fail(
        `Statement ${index + 1} of ${migration.name} is not one of the ` +
          'reviewed statement shapes. Refusing to execute.'
      );
    }
    if (migration.forbidden.test(statement)) {
      fail(
        `Statement ${index + 1} of ${migration.name} contains a destructive ` +
          'or data-writing keyword. Refusing to execute.'
      );
    }
  }

  return statements;
}

async function verifyPrerequisites(sql) {
  const rows = await sql.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_users'
        AND column_name = 'user_id'`,
    []
  );
  if (rows.length === 0) {
    fail(
      'Signals requires app_users.user_id. Apply the Phase 1 identity ' +
        'migration first.'
    );
  }
}

async function inspectSchema(sql) {
  const tableRows = await sql.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ANY($1::text[])`,
    [TABLES]
  );
  const presentTables = tableRows.map((row) => String(row.table_name));

  const columnRows = await sql.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [TABLES]
  );
  const columns = new Map();
  for (const row of columnRows) {
    const table = String(row.table_name);
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(String(row.column_name));
  }

  const indexRows = await sql.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
    [REQUIRED_INDEXES]
  );
  const presentIndexes = new Set(indexRows.map((row) => String(row.indexname)));

  const constraintRows = await sql.query(
    `SELECT t.relname AS table_name, c.conname AS constraint_name
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])`,
    [TABLES]
  );
  const presentConstraints = new Set(
    constraintRows.map((row) => `${row.table_name}.${row.constraint_name}`)
  );

  return { presentTables, columns, presentIndexes, presentConstraints };
}

function describeState(inspection) {
  const missingTables = TABLES.filter(
    (table) => !inspection.presentTables.includes(table)
  );

  const missingColumns = [];
  for (const table of TABLES) {
    if (!inspection.presentTables.includes(table)) continue;
    const have = inspection.columns.get(table) || new Set();
    for (const column of EXPECTED_SCHEMA[table]) {
      if (!have.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  const missingIndexes = REQUIRED_INDEXES.filter(
    (name) => !inspection.presentIndexes.has(name)
  );
  const missingConstraints = REQUIRED_CONSTRAINTS.filter(
    (name) => !inspection.presentConstraints.has(name)
  );

  const complete =
    missingTables.length === 0 &&
    missingColumns.length === 0 &&
    missingIndexes.length === 0 &&
    missingConstraints.length === 0;
  const pristine =
    inspection.presentTables.length === 0 &&
    inspection.presentIndexes.size === 0 &&
    inspection.presentConstraints.size === 0;

  return {
    complete,
    pristine,
    missingTables,
    missingColumns,
    missingIndexes,
    missingConstraints,
  };
}

function partialStateMessage(state) {
  const parts = [];
  if (state.missingTables.length > 0) {
    parts.push(`missing tables: ${state.missingTables.join(', ')}`);
  }
  if (state.missingColumns.length > 0) {
    parts.push(`missing columns: ${state.missingColumns.slice(0, 8).join(', ')}`);
  }
  if (state.missingIndexes.length > 0) {
    parts.push(`missing indexes: ${state.missingIndexes.join(', ')}`);
  }
  if (state.missingConstraints.length > 0) {
    parts.push(`missing constraints: ${state.missingConstraints.slice(0, 8).join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * The only supported non-pristine upgrade: the base schema from
 * 2026-11-14-add-signals.sql is complete and only the fingerprint column and
 * its CHECK are absent. A column without its constraint (or vice versa) is a
 * contradiction and is treated as an unknown partial state.
 */
function onlyFingerprintMissing(state) {
  return (
    state.missingTables.length === 0 &&
    state.missingIndexes.length === 0 &&
    state.missingColumns.length === 1 &&
    state.missingColumns[0] === FINGERPRINT_COLUMN &&
    state.missingConstraints.length === 1 &&
    state.missingConstraints[0] === FINGERPRINT_CONSTRAINT
  );
}

async function main() {
  const { url, target } = readApprovedTarget();

  console.log(
    `Database target: host=${target.host} database=${target.database} ` +
      `sslmode=${target.sslmode} source=SIGNALS_DATABASE_URL (credentials omitted)`
  );

  const { neon } = require('@neondatabase/serverless');
  const sql = neon(url);

  await verifyPrerequisites(sql);

  const before = describeState(await inspectSchema(sql));
  if (before.complete) {
    console.log('Signals schema is already fully applied; nothing to execute.');
    return;
  }

  const plan = before.pristine
    ? MIGRATIONS
    : onlyFingerprintMissing(before)
      ? [FINGERPRINT_MIGRATION_SPEC]
      : null;
  if (!plan) {
    fail(
      'Signals schema is partially applied and will not be modified: ' +
        `${partialStateMessage(before)}. Inspect the database manually.`
    );
  }

  // Every planned file is validated before the first write, so a rejected
  // statement cannot leave the schema half-applied by this runner.
  const loaded = plan.map((migration) => ({
    migration,
    statements: loadStatements(migration),
  }));

  const startedAt = Date.now();
  for (const { migration, statements } of loaded) {
    console.log(
      `Applying only ${migration.name} (${statements.length} statements) …`
    );
    for (const [index, statement] of statements.entries()) {
      try {
        await sql.query(statement, []);
        executedStatements += 1;
      } catch (error) {
        const snippet = statement.replace(/\s+/g, ' ').slice(0, 160);
        console.error(
          `Migration failed at statement ${index + 1}/${statements.length} ` +
            `of ${migration.name}.`
        );
        console.error(`  SQL: ${snippet}${statement.length > 160 ? ' …' : ''}`);
        console.error(`  PostgreSQL: ${errorMessage(error)}`);
        fail(`${migration.name} stopped.`);
      }
    }
  }
  planCompleted = true;

  const after = describeState(await inspectSchema(sql));
  if (!after.complete) {
    fail(
      'The migration ran but verification failed: ' +
        `${partialStateMessage(after)}.`
    );
  }

  console.log(
    `Signals migration complete (${Date.now() - startedAt} ms). Verified: ` +
      `${TABLES.length} tables, ${REQUIRED_INDEXES.length} indexes, ` +
      `${REQUIRED_CONSTRAINTS.length} constraints.`
  );
}

function errorMessage(error) {
  if (!error) return 'unknown error';
  const parts = [error.message || String(error)];
  if (error.code) parts.push(`code=${error.code}`);
  return parts.join(' | ');
}

main().catch((error) => {
  console.error('Signals migration failed:', errorMessage(error));
  process.exit(1);
});
