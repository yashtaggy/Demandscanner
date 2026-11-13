#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node entry point */
/**
 * DemandScan — Phase 1.5 targeted migration runner.
 *
 * db/migrate.js applies schema.sql and EVERY file in db/migrations on each run.
 * That is not a safe way to apply a single new phase migration, because it also
 * re-runs every previously applied file against the target database.
 *
 * This runner applies exactly one file:
 *
 *   db/migrations/2026-11-12-add-phase1-5-broker-market-data.sql
 *
 * Safety properties:
 *   * Reads PHASE15_DATABASE_URL only. It never falls back to DATABASE_URL or
 *     .env.local, so it cannot pick up the application's configured database
 *     by accident.
 *   * Requires ALLOW_PHASE15_MIGRATION=YES as an explicit write approval.
 *   * Requires EXPECTED_PHASE15_HOST and refuses any host mismatch.
 *   * Refuses FORBIDDEN_DATABASE_HOST when supplied.
 *   * Refuses pooled Neon hosts (migrations should run direct).
 *   * Refuses to run when NODE_ENV=production.
 *   * Executes only statements that begin with CREATE, so an accidental
 *     destructive statement in the file aborts before execution.
 *   * Prints sanitized target metadata only; credentials are never printed.
 *
 * Usage:
 *   PHASE15_DATABASE_URL="postgresql://...direct..." \
 *   EXPECTED_PHASE15_HOST="ep-<id>.<region>.aws.neon.tech" \
 *   FORBIDDEN_DATABASE_HOST="<production-host>" \
 *   ALLOW_PHASE15_MIGRATION=YES \
 *   npm run db:phase1-5:migrate
 *
 * Do not point PHASE15_DATABASE_URL at a production database.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { describeTarget } = require('./target');
const { splitStatements } = require('./sql-statements');

const MIGRATION_FILE = '2026-11-12-add-phase1-5-broker-market-data.sql';
const MIGRATION_PATH = join(__dirname, 'migrations', MIGRATION_FILE);

const PHASE15_TABLES = [
  'market_data_connections',
  'market_data_oauth_states',
  'global_ingestion_locks',
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readApprovedUrl() {
  const url = process.env.PHASE15_DATABASE_URL?.trim();
  if (!url) {
    fail(
      'PHASE15_DATABASE_URL is required. This runner intentionally does not ' +
        'fall back to DATABASE_URL or .env.local.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production.');
  }

  if (process.env.ALLOW_PHASE15_MIGRATION !== 'YES') {
    fail('Set ALLOW_PHASE15_MIGRATION=YES to approve this write.');
  }

  const expectedHost = process.env.EXPECTED_PHASE15_HOST?.trim();
  if (!expectedHost) {
    fail('EXPECTED_PHASE15_HOST is required (direct Neon hostname).');
  }

  const target = describeTarget(url);
  if (!target.isNeon) {
    fail('PHASE15_DATABASE_URL must point at a Neon Postgres host.');
  }
  if (target.pooled) {
    fail('Use the direct (non-pooler) Neon host for migrations.');
  }
  if (target.host !== expectedHost) {
    fail(
      `Target host "${target.host}" does not match EXPECTED_PHASE15_HOST.`
    );
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
    if (!/^CREATE\b/i.test(statement)) {
      fail(
        `Statement ${index + 1} of ${MIGRATION_FILE} does not start with ` +
          'CREATE. Phase 1.5 is additive only; refusing to execute.'
      );
    }
  }

  return statements;
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
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)`,
    [PHASE15_TABLES]
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = PHASE15_TABLES.filter((table) => !present.has(table));
  if (missing.length > 0) {
    fail(`Phase 1.5 tables missing after migration: ${missing.join(', ')}`);
  }

  console.log(
    `Phase 1.5 migration complete. Verified tables: ${PHASE15_TABLES.join(', ')}`
  );
}

main().catch((err) => {
  console.error(
    'Phase 1.5 migration failed:',
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
