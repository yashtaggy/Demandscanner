#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node entry point */
/**
 * DemandScan — Phase 3 targeted migration runner.
 *
 * Applies exactly one file:
 *
 *   db/migrations/2026-11-13-live-trade-internal-ownership.sql
 *
 * Safety properties:
 *   * Reads PHASE3_DATABASE_URL only. Never falls back to DATABASE_URL.
 *   * Requires ALLOW_PHASE3_MIGRATION=YES as an explicit write approval.
 *   * Requires EXPECTED_PHASE3_HOST and refuses any host mismatch.
 *   * Refuses FORBIDDEN_DATABASE_HOST when supplied.
 *   * Refuses pooled Neon hosts and NODE_ENV=production.
 *   * Refuses to convert legacy TEXT ownership while any Live Trade row
 *     exists. There is no guessing, default owner or text-to-UUID mapping.
 *   * Executes only the reviewed statement shapes of this one migration and
 *     aborts on any INSERT/UPDATE/DELETE/TRUNCATE/GRANT/REVOKE.
 *   * Prints sanitized target metadata only, never credentials.
 *
 * Usage:
 *   PHASE3_DATABASE_URL="postgresql://...direct..." \
 *   EXPECTED_PHASE3_HOST="ep-<id>.<region>.aws.neon.tech" \
 *   FORBIDDEN_DATABASE_HOST="<production-host>" \
 *   ALLOW_PHASE3_MIGRATION=YES \
 *   npm run db:phase3:migrate
 *
 * Do not point PHASE3_DATABASE_URL at a production database.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { describeTarget } = require('./target');
const { splitStatements } = require('./sql-statements');

const MIGRATION_FILE = '2026-11-13-live-trade-internal-ownership.sql';
const MIGRATION_PATH = join(__dirname, 'migrations', MIGRATION_FILE);
const PHASE1_MIGRATION = '2026-11-12-add-internal-identity-foundation.sql';
const BASE_LIVE_TRADE_MIGRATION = '2026-11-06-add-live-trade.sql';

const OWNER_TABLES = [
  'live_trade_groups',
  'live_trade_items',
  'live_trade_quote_state',
];

const REQUIRED_PREREQUISITES = [
  ['app_users', 'user_id'],
  ['kite_sessions', 'session_id_hash'],
  ['instruments', 'instrument_id'],
  ['live_trade_groups', 'owner_user_id'],
  ['live_trade_items', 'owner_user_id'],
  ['live_trade_quote_state', 'owner_user_id'],
];

// `ON DELETE CASCADE` is part of a foreign-key definition, not a row delete,
// so only a statement-level DELETE is rejected.
const FORBIDDEN_KEYWORDS = /\b(TRUNCATE|GRANT|REVOKE|INSERT|UPDATE)\b|\bDELETE\s+FROM\b/i;

const ALLOWED_STATEMENTS = [
  /^DROP\s+INDEX\s+IF\s+EXISTS\s+live_trade_items_owner_instrument_uq$/i,
  /^ALTER\s+TABLE\s+(live_trade_groups|live_trade_items|live_trade_quote_state)\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+\w+$/i,
  /^ALTER\s+TABLE\s+(live_trade_groups|live_trade_items|live_trade_quote_state)\s+ALTER\s+COLUMN\s+owner_user_id\s+TYPE\s+UUID\s+USING\s+owner_user_id::uuid$/i,
  /^ALTER\s+TABLE\s+(live_trade_groups|live_trade_items|live_trade_quote_state)\s+ALTER\s+COLUMN\s+owner_user_id\s+SET\s+NOT\s+NULL$/i,
  /^ALTER\s+TABLE\s+(live_trade_groups|live_trade_items|live_trade_quote_state)\s+ADD\s+CONSTRAINT\s+\w+\s+FOREIGN\s+KEY\b[\s\S]+$/i,
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+kite_session_bindings\s*\([\s\S]+\)$/i,
  /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+kite_session_bindings_user_idx\s+ON\s+kite_session_bindings\s*\(\s*app_user_id\s*\)$/i,
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readApprovedUrl() {
  const url = process.env.PHASE3_DATABASE_URL?.trim();
  if (!url) {
    fail(
      'PHASE3_DATABASE_URL is required. This runner intentionally does not ' +
        'fall back to DATABASE_URL or .env.local.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production.');
  }

  if (process.env.ALLOW_PHASE3_MIGRATION !== 'YES') {
    fail('Set ALLOW_PHASE3_MIGRATION=YES to approve this write.');
  }

  const expectedHost = process.env.EXPECTED_PHASE3_HOST?.trim();
  if (!expectedHost) {
    fail('EXPECTED_PHASE3_HOST is required (direct Neon hostname).');
  }

  const target = describeTarget(url);
  if (!target.isNeon) {
    fail('PHASE3_DATABASE_URL must point at a Neon Postgres host.');
  }
  if (target.pooled) {
    fail('Use the direct (non-pooler) Neon host for migrations.');
  }
  if (target.host !== expectedHost) {
    fail(`Target host "${target.host}" does not match EXPECTED_PHASE3_HOST.`);
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
        AND table_name IN ('app_users', 'kite_sessions', 'instruments',
                           'live_trade_groups', 'live_trade_items',
                           'live_trade_quote_state')`,
    []
  );
  const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = REQUIRED_PREREQUISITES.filter(
    ([table, column]) => !found.has(`${table}.${column}`)
  );

  if (missing.length > 0) {
    fail(
      'Phase 3 requires ' +
        `${missing.map(([table, column]) => `${table}.${column}`).join(', ')}. ` +
        `Apply ${PHASE1_MIGRATION} and ${BASE_LIVE_TRADE_MIGRATION} first ` +
        '(the ordered set is Phase 1, Phase 1.5, Phase 2, base Live Trade, ' +
        `repeat instruments, then ${MIGRATION_FILE}). No statements were executed.`
    );
  }
}

async function inspectOwnershipColumns(sql) {
  const rows = await sql.query(
    `SELECT table_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'owner_user_id'
        AND table_name IN ('live_trade_groups', 'live_trade_items',
                           'live_trade_quote_state')`,
    []
  );

  const byTable = new Map(rows.map((row) => [row.table_name, row]));
  const missing = OWNER_TABLES.filter((table) => !byTable.has(table));
  if (missing.length > 0) {
    fail(`Missing owner_user_id columns: ${missing.join(', ')}`);
  }

  const types = new Set(
    OWNER_TABLES.map((table) => String(byTable.get(table).data_type))
  );
  const unsupported = [...types].filter(
    (type) => type !== 'text' && type !== 'uuid'
  );
  if (unsupported.length > 0) {
    fail(
      `Unsupported owner_user_id column type(s): ${unsupported.join(', ')}. ` +
        'Expected text (legacy) or uuid (already migrated).'
    );
  }
  if (types.size > 1) {
    fail(
      'owner_user_id column types are inconsistent across Live Trade tables. ' +
        'Inspect the schema before migrating; no statements were executed.'
    );
  }

  const status = OWNER_TABLES.map((table) => ({
    table,
    type: String(byTable.get(table).data_type),
    nullable: byTable.get(table).is_nullable === 'YES',
  }));
  return { type: [...types][0], status };
}

async function assertNoLegacyRows(sql, type) {
  if (type !== 'text') return;

  const counts = [];
  for (const table of OWNER_TABLES) {
    const rows = await sql.query(
      `SELECT count(*)::bigint AS row_count FROM ${table}`,
      []
    );
    counts.push({
      table,
      rowCount: Number(rows[0]?.row_count ?? 0),
    });
  }

  const populated = counts.filter((entry) => entry.rowCount > 0);
  if (populated.length > 0) {
    fail(
      'Legacy TEXT ownership still has rows: ' +
        `${populated
          .map((entry) => `${entry.table}=${entry.rowCount}`)
          .join(', ')}. ` +
        'No owner mapping or default owner is guessed. Resolve the mapping ' +
        'explicitly before migrating. No statements were executed.'
    );
  }
}

async function verifyResult(sql) {
  const columns = await sql.query(
    `SELECT table_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'owner_user_id'
        AND table_name IN ('live_trade_groups', 'live_trade_items',
                           'live_trade_quote_state')`,
    []
  );
  const columnsOk = OWNER_TABLES.every((table) => {
    const row = columns.find((candidate) => candidate.table_name === table);
    return row && row.data_type === 'uuid' && row.is_nullable === 'NO';
  });
  if (!columnsOk) {
    fail('owner_user_id is not UUID NOT NULL on every Live Trade table.');
  }

  const constraints = await sql.query(
    `SELECT t.relname AS table_name,
            c.conname AS constraint_name,
            c.contype AS constraint_type,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname IN ('live_trade_groups', 'live_trade_items',
                          'live_trade_quote_state', 'kite_session_bindings')`,
    []
  );

  const hasOwnerFk = (table) =>
    constraints.some(
      (row) =>
        row.table_name === table &&
        row.constraint_type === 'f' &&
        /app_users/.test(row.definition) &&
        /ON DELETE CASCADE/i.test(row.definition)
    );
  const missingFks = OWNER_TABLES.filter((table) => !hasOwnerFk(table));
  if (missingFks.length > 0) {
    fail(`Missing app_users owner foreign key on: ${missingFks.join(', ')}`);
  }

  const composite = constraints.find(
    (row) =>
      row.table_name === 'live_trade_items' &&
      row.constraint_type === 'f' &&
      /live_trade_groups/.test(row.definition) &&
      /group_id/.test(row.definition) &&
      /owner_user_id/.test(row.definition)
  );
  if (!composite) {
    fail('The (group_id, owner_user_id) foreign key is missing.');
  }
  if (/ON DELETE/i.test(composite.definition)) {
    fail('The composite group foreign key must remain NO ACTION.');
  }

  const repeatIndex = await sql.query(
    `SELECT to_regclass('public.live_trade_items_owner_instrument_uq') AS index_name`,
    []
  );
  if (repeatIndex[0]?.index_name) {
    fail('The legacy (owner_user_id, instrument_id) unique index exists again.');
  }

  const binding = await sql.query(
    `SELECT to_regclass('public.kite_session_bindings') AS table_name`,
    []
  );
  if (!binding[0]?.table_name) {
    fail('kite_session_bindings was not created.');
  }

  const bindingFks = constraints.filter(
    (row) => row.table_name === 'kite_session_bindings' && row.constraint_type === 'f'
  );
  if (
    !bindingFks.some((row) => /kite_sessions/.test(row.definition)) ||
    !bindingFks.some((row) => /app_users/.test(row.definition))
  ) {
    fail('kite_session_bindings is missing its session or app-user foreign key.');
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
  const ownership = await inspectOwnershipColumns(sql);
  console.log(
    'Owner columns before migration: ' +
      ownership.status
        .map((entry) => `${entry.table}=${entry.type}${entry.nullable ? '/null' : '/not-null'}`)
        .join(', ')
  );

  await assertNoLegacyRows(sql, ownership.type);

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
    'Phase 3 migration complete. Verified: UUID NOT NULL ownership on ' +
      'live_trade_groups/live_trade_items/live_trade_quote_state, ' +
      'app_users foreign keys with cascade, composite group foreign key, ' +
      'no repeat-instrument uniqueness, kite_session_bindings.'
  );
}

main().catch((err) => {
  console.error(
    'Phase 3 migration failed:',
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
