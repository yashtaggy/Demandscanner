#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node entry point */
/**
 * DemandScan — Phase 2 targeted migration runner.
 *
 * Applies exactly one file:
 *
 *   db/migrations/2026-11-12-add-phase2-firebase-auth.sql
 *
 * Safety properties:
 *   * Reads PHASE2_DATABASE_URL only. Never falls back to DATABASE_URL.
 *   * Requires ALLOW_PHASE2_MIGRATION=YES as an explicit write approval.
 *   * Requires EXPECTED_PHASE2_HOST and refuses any host mismatch.
 *   * Refuses FORBIDDEN_DATABASE_HOST when supplied.
 *   * Refuses pooled Neon hosts (migrations should run direct).
 *   * Refuses to run when NODE_ENV=production.
 *   * Executes only CREATE statements and ADD COLUMN IF NOT EXISTS statements
 *     on app_users/scan_jobs. Any destructive keyword aborts before execution.
 *   * Prints sanitized target metadata only.
 *
 * Usage:
 *   PHASE2_DATABASE_URL="postgresql://...direct..." \
 *   EXPECTED_PHASE2_HOST="ep-<id>.<region>.aws.neon.tech" \
 *   FORBIDDEN_DATABASE_HOST="<production-host>" \
 *   ALLOW_PHASE2_MIGRATION=YES \
 *   npm run db:phase2:migrate
 *
 * Do not point PHASE2_DATABASE_URL at a production database.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { describeTarget } = require('./target');
const { splitStatements } = require('./sql-statements');

const MIGRATION_FILE = '2026-11-12-add-phase2-firebase-auth.sql';
const MIGRATION_PATH = join(__dirname, 'migrations', MIGRATION_FILE);
const PHASE1_MIGRATION = '2026-11-12-add-internal-identity-foundation.sql';

// Phase 2 ALTERs app_users/scan_jobs and relies on the Phase 1 identity
// mapping, so applying it to a database without Phase 1 must fail with an
// explicit ordering error rather than a raw "relation does not exist".
const PHASE1_REQUIRED_COLUMNS = [
  ['app_users', 'user_id'],
  ['app_users', 'email'],
  ['app_users', 'status'],
  ['user_identities', 'provider_user_id'],
  ['scan_jobs', 'job_id'],
];

const FORBIDDEN_KEYWORDS = /\b(DROP|TRUNCATE|DELETE|UPDATE|GRANT|REVOKE)\b/i;
const ADDITIVE_ALTER =
  /^ALTER\s+TABLE\s+(app_users|scan_jobs)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readApprovedUrl() {
  const url = process.env.PHASE2_DATABASE_URL?.trim();
  if (!url) {
    fail(
      'PHASE2_DATABASE_URL is required. This runner intentionally does not ' +
        'fall back to DATABASE_URL or .env.local.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production.');
  }

  if (process.env.ALLOW_PHASE2_MIGRATION !== 'YES') {
    fail('Set ALLOW_PHASE2_MIGRATION=YES to approve this write.');
  }

  const expectedHost = process.env.EXPECTED_PHASE2_HOST?.trim();
  if (!expectedHost) {
    fail('EXPECTED_PHASE2_HOST is required (direct Neon hostname).');
  }

  const target = describeTarget(url);
  if (!target.isNeon) {
    fail('PHASE2_DATABASE_URL must point at a Neon Postgres host.');
  }
  if (target.pooled) {
    fail('Use the direct (non-pooler) Neon host for migrations.');
  }
  if (target.host !== expectedHost) {
    fail(`Target host "${target.host}" does not match EXPECTED_PHASE2_HOST.`);
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
    const additive = /^CREATE\b/i.test(statement) || ADDITIVE_ALTER.test(statement);
    if (!additive) {
      fail(
        `Statement ${index + 1} of ${MIGRATION_FILE} is not an additive ` +
          'CREATE or ADD COLUMN IF NOT EXISTS. Refusing to execute.'
      );
    }
    if (FORBIDDEN_KEYWORDS.test(statement)) {
      fail(
        `Statement ${index + 1} of ${MIGRATION_FILE} contains a destructive ` +
          'keyword. Refusing to execute.'
      );
    }
  }

  return statements;
}

async function verifyPhase1Prerequisites(sql) {
  const rows = await sql.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('app_users', 'user_identities', 'scan_jobs')`,
    []
  );
  const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = PHASE1_REQUIRED_COLUMNS.filter(
    ([table, column]) => !found.has(`${table}.${column}`)
  );

  if (missing.length > 0) {
    fail(
      'Phase 2 builds on Phase 1 and requires ' +
        `${missing.map(([table, column]) => `${table}.${column}`).join(', ')}. ` +
        `Apply ${PHASE1_MIGRATION} first (the ordered set is Phase 1, ` +
        `Phase 1.5, then ${MIGRATION_FILE}). No statements were executed.`
    );
  }
}

async function verifyConstraints(sql) {
  const rows = await sql.query(
    `SELECT t.relname AS table_name,
            c.contype AS constraint_type,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname IN ('app_users', 'scan_jobs')`,
    []
  );

  const hasRoleCheck = rows.some(
    (row) =>
      row.table_name === 'app_users' &&
      row.constraint_type === 'c' &&
      /\brole\b/.test(row.definition) &&
      /SUPER_ADMIN/.test(row.definition) &&
      /ADMIN/.test(row.definition) &&
      /CUSTOMER/.test(row.definition)
  );
  const hasOwnerFk = rows.some(
    (row) =>
      row.table_name === 'scan_jobs' &&
      row.constraint_type === 'f' &&
      /app_users/.test(row.definition) &&
      /ON DELETE SET NULL/i.test(row.definition)
  );

  const missing = [];
  if (!hasRoleCheck) missing.push('app_users.role CHECK constraint');
  if (!hasOwnerFk) missing.push('scan_jobs.initiator_user_id foreign key');
  if (missing.length > 0) {
    fail(`Phase 2 constraints missing after migration: ${missing.join(', ')}`);
  }
}

async function main() {
  const { url, target } = readApprovedUrl();
  const statements = loadStatements();

  console.log(
    `Database target: host=${target.host} database=${target.database} ` +
      `sslmode=${target.sslmode} (credentials omitted)`
  );
  console.log(`Applying only ${MIGRATION_FILE} (${statements.length} statements) …`);

  const { neon } = require('@neondatabase/serverless');
  const sql = neon(url);

  await verifyPhase1Prerequisites(sql);

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

  const rows = await sql.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'app_users' AND column_name = 'role')
          OR (table_name = 'scan_jobs' AND column_name = 'initiator_user_id')
          OR table_name = 'auth_rate_limits'
        )`,
    []
  );
  const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const expected = ['app_users.role', 'scan_jobs.initiator_user_id', 'auth_rate_limits.rate_key'];
  const missing = expected.filter((item) => !found.has(item));
  if (missing.length > 0) {
    fail(`Phase 2 schema objects missing after migration: ${missing.join(', ')}`);
  }

  await verifyConstraints(sql);

  console.log(
    `Phase 2 migration complete. Verified: ${expected.join(', ')}, ` +
      'app_users.role CHECK, scan_jobs owner FK'
  );
}

main().catch((err) => {
  console.error(
    'Phase 2 migration failed:',
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
