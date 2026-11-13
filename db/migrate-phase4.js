#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node entry point */
/**
 * DemandScan — Phase 4 targeted migration runner.
 *
 * Applies exactly one file:
 *
 *   db/migrations/2026-11-13-phase4-subscriptions.sql
 *
 * Safety properties:
 *   * Reads PHASE4_DATABASE_URL only. Never falls back to DATABASE_URL.
 *   * Requires ALLOW_PHASE4_MIGRATION=YES as an explicit write approval.
 *   * Requires EXPECTED_PHASE4_HOST and refuses any host mismatch.
 *   * Refuses FORBIDDEN_DATABASE_HOST when supplied.
 *   * Refuses pooled Neon hosts and NODE_ENV=production.
 *   * Executes only CREATE TABLE / CREATE INDEX / CREATE FUNCTION statements
 *     from this one migration. Any INSERT/UPDATE/DELETE/TRUNCATE/GRANT/REVOKE
 *     aborts before execution.
 *   * Prints sanitized target metadata only, never credentials.
 *
 * Usage:
 *   PHASE4_DATABASE_URL="postgresql://...direct..." \
 *   EXPECTED_PHASE4_HOST="ep-<id>.<region>.aws.neon.tech" \
 *   FORBIDDEN_DATABASE_HOST="<production-host>" \
 *   ALLOW_PHASE4_MIGRATION=YES \
 *   npm run db:phase4:migrate
 *
 * Do not point PHASE4_DATABASE_URL at a production database.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { describeTarget } = require('./target');
const { splitStatements } = require('./sql-statements');

const MIGRATION_FILE = '2026-11-13-phase4-subscriptions.sql';
const MIGRATION_PATH = join(__dirname, 'migrations', MIGRATION_FILE);
const PHASE1_MIGRATION = '2026-11-12-add-internal-identity-foundation.sql';

const FORBIDDEN_KEYWORDS =
  /\b(TRUNCATE|GRANT|REVOKE|INSERT|UPDATE)\b|\bDELETE\s+FROM\b/i;

const ALLOWED_STATEMENTS = [
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(subscription_plans|customer_subscriptions|payment_records)\s*\([\s\S]+\)$/i,
  /^CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+subscription_plans_name_lower_uq\s+ON\s+subscription_plans\b[\s\S]+$/i,
  /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+(subscription_plans|customer_subscriptions|payment_records)\b[\s\S]+$/i,
  /^CREATE\s+OR\s+REPLACE\s+FUNCTION\s+is_subscription_entitled\b[\s\S]+$/i,
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readApprovedUrl() {
  const url = process.env.PHASE4_DATABASE_URL?.trim();
  if (!url) {
    fail(
      'PHASE4_DATABASE_URL is required. This runner intentionally does not ' +
        'fall back to DATABASE_URL or .env.local.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production.');
  }

  if (process.env.ALLOW_PHASE4_MIGRATION !== 'YES') {
    fail('Set ALLOW_PHASE4_MIGRATION=YES to approve this write.');
  }

  const expectedHost = process.env.EXPECTED_PHASE4_HOST?.trim();
  if (!expectedHost) {
    fail('EXPECTED_PHASE4_HOST is required (direct Neon hostname).');
  }

  const target = describeTarget(url);
  if (!target.isNeon) {
    fail('PHASE4_DATABASE_URL must point at a Neon Postgres host.');
  }
  if (target.pooled) {
    fail('Use the direct (non-pooler) Neon host for migrations.');
  }
  if (target.host !== expectedHost) {
    fail(`Target host "${target.host}" does not match EXPECTED_PHASE4_HOST.`);
  }

  const forbidden = process.env.FORBIDDEN_DATABASE_HOST?.trim();
  if (forbidden && target.host === forbidden) {
    fail('Target host matches FORBIDDEN_DATABASE_HOST.');
  }

  return { url, target };
}

function loadStatements() {
  const sqlText = readFileSync(MIGRATION_PATH, 'utf8');
  const statements = splitStatements(sqlText);
  if (statements.length === 0) {
    fail(`Migration file ${MIGRATION_FILE} contains no statements.`);
  }

  for (const [index, statement] of statements.entries()) {
    const allowed = ALLOWED_STATEMENTS.some((pattern) => pattern.test(statement));
    if (!allowed) {
      fail(
        `Statement ${index + 1} of ${MIGRATION_FILE} is not one of the ` +
          'reviewed statement shapes. Refusing to execute.'
      );
    }
    if (FORBIDDEN_KEYWORDS.test(statement)) {
      fail(
        `Statement ${index + 1} of ${MIGRATION_FILE} contains a data-writing ` +
          'keyword. Refusing to execute.'
      );
    }
  }

  return statements;
}

async function verifyPrerequisites(sql) {
  const rows = await sql.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_users'
        AND column_name IN ('user_id', 'status', 'role')`,
    []
  );
  const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = ['user_id', 'status', 'role'].filter(
    (column) => !found.has(`app_users.${column}`)
  );

  if (missing.length > 0) {
    fail(
      `Phase 4 requires app_users.${missing.join(', app_users.')}. ` +
        `Apply ${PHASE1_MIGRATION} and the Phase 2 migration first. ` +
        'No statements were executed.'
    );
  }
}

async function verifyResult(sql) {
  const tables = ['subscription_plans', 'customer_subscriptions', 'payment_records'];
  const columns = await sql.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [tables]
  );
  const byTable = new Map();
  for (const row of columns) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name).add(row.column_name);
  }

  const required = {
    subscription_plans: ['plan_id', 'duration_days', 'price', 'currency', 'status'],
    customer_subscriptions: [
      'subscription_id',
      'user_id',
      'plan_id',
      'start_date',
      'end_date',
      'status',
      'cancelled_at',
      'cancellation_reason',
      'renewed_from_subscription_id',
    ],
    payment_records: [
      'payment_id',
      'user_id',
      'subscription_id',
      'amount',
      'currency',
      'payment_method',
      'payment_date',
      'payment_status',
    ],
  };

  for (const [table, expected] of Object.entries(required)) {
    const actual = byTable.get(table);
    if (!actual) fail(`${table} was not created.`);
    const missing = expected.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      fail(`${table} is missing columns: ${missing.join(', ')}.`);
    }
  }

  const constraints = await sql.query(
    `SELECT t.relname AS table_name,
            c.contype AS constraint_type,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname IN ('customer_subscriptions', 'payment_records')`,
    []
  );

  const hasFk = (table, pattern) =>
    constraints.some(
      (row) =>
        row.table_name === table &&
        row.constraint_type === 'f' &&
        pattern.test(row.definition)
    );

  if (
    !hasFk('customer_subscriptions', /app_users/) ||
    !hasFk('customer_subscriptions', /subscription_plans/) ||
    !hasFk('payment_records', /app_users/) ||
    !hasFk('payment_records', /customer_subscriptions/)
  ) {
    fail('Phase 4 foreign keys are missing.');
  }

  if (!hasFk('payment_records', /ON DELETE RESTRICT/i)) {
    fail('payment_records must keep its audit-preserving RESTRICT foreign key.');
  }

  const fn = await sql.query(
    `SELECT pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'is_subscription_entitled'`,
    []
  );
  if (fn.length !== 1) {
    fail('is_subscription_entitled() was not created exactly once.');
  }
  if (!/Asia\/Kolkata/.test(String(fn[0].definition))) {
    fail('is_subscription_entitled() does not evaluate Asia/Kolkata dates.');
  }
}

async function main() {
  const { url, target } = readApprovedUrl();
  const statements = loadStatements();

  console.log(
    `Database target: host=${target.host} database=${target.database} ` +
      `sslmode=${target.sslmode} (credentials omitted)`
  );

  const { neon } = require('@neondatabase/serverless');
  const sql = neon(url);

  await verifyPrerequisites(sql);

  console.log(`Applying only ${MIGRATION_FILE} (${statements.length} statements) …`);

  for (const [index, statement] of statements.entries()) {
    try {
      await sql.query(statement, []);
    } catch (err) {
      console.error(
        `Migration failed at statement ${index + 1}: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }
  }

  await verifyResult(sql);

  console.log(
    'Phase 4 migration complete. Verified: subscription_plans, ' +
      'customer_subscriptions, payment_records, audit-preserving foreign ' +
      'keys, and the Asia/Kolkata entitlement predicate.'
  );
}

main().catch((err) => {
  console.error(
    'Phase 4 migration failed:',
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
