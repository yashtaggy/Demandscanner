#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node entry point */
/**
 * DemandScan — Phase 5A development-database initialization runner.
 *
 * Initializes an EMPTY development Neon database from scratch with the complete
 * schema the current application requires. It is not a general migration
 * runner and it is not used for production or staging.
 *
 * Safety properties:
 *   * Reads the target from PHASE5A_DATABASE_URL, or from the explicit
 *     development env file named by PHASE5A_ENV_FILE (must be `.env.local`).
 *     It never reads DATABASE_URL directly and never falls back to another
 *     file or host.
 *   * Requires ALLOW_PHASE5A_MIGRATION=YES as an explicit write approval.
 *   * Requires EXPECTED_PHASE5A_HOST to equal the single authorized
 *     development host hard-coded below, so a typo cannot redirect the run.
 *   * Requires database name `neondb`, a Neon host, and a direct
 *     (non-pooler) endpoint; refuses NODE_ENV=production.
 *   * Starts only from an empty public schema, or resumes from a verified
 *     applied prefix. It never drops, truncates or resets anything to recover
 *     from a failure.
 *   * Refuses any statement that writes data (INSERT/UPDATE/DELETE/TRUNCATE/
 *     GRANT/REVOKE/COPY) and any statement outside the reviewed DDL shapes.
 *   * Prints each migration filename before applying it, records success or
 *     failure per file, and stops at the first failing statement.
 *   * Verifies the expected schema (tables, columns, foreign keys, indexes,
 *     constraints, the entitlement function) after execution.
 *
 * Usage:
 *   PHASE5A_ENV_FILE=.env.local \
 *   EXPECTED_PHASE5A_HOST="ep-quiet-resonance-bdscyunv.c-8.us-east-2.aws.neon.tech" \
 *   ALLOW_PHASE5A_MIGRATION=YES \
 *   npm run db:phase5a:init
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { describeTarget } = require('./target');
const { splitStatements } = require('./sql-statements');
const { EXPECTED_SCHEMA } = require('./expected-schema');

const AUTHORIZED_HOST = 'ep-quiet-resonance-bdscyunv.c-8.us-east-2.aws.neon.tech';
const AUTHORIZED_DATABASE = 'neondb';
const REPO_ROOT = path.join(__dirname, '..');

/**
 * The complete initialization chain, in dependency order. Each file depends
 * only on files above it (plus db/schema.sql for kite_sessions).
 */
const STEPS = [
  {
    file: 'schema.sql',
    note: 'baseline: kite_sessions (required by Phase 3 bindings)',
    verifyApplied: (sql) => hasTable(sql, 'kite_sessions'),
  },
  {
    file: 'migrations/2024-10-18-add-aggregation-schema.sql',
    verifyApplied: (sql) => hasTable(sql, 'aggregated_candles'),
  },
  {
    file: 'migrations/2024-10-18-add-scanner-schema.sql',
    verifyApplied: async (sql) =>
      (await hasTable(sql, 'instruments')) &&
      (await hasTable(sql, 'scan_jobs')) &&
      (await hasTable(sql, 'scanner_configs')),
  },
  {
    file: 'migrations/2024-10-18-v1-intraday-scoring-history.sql',
    verifyApplied: async (sql) =>
      (await hasColumn(sql, 'zones', 'composite_score')) &&
      (await hasTable(sql, 'hourly_candles')) &&
      (await hasTable(sql, 'nifty500_membership')),
  },
  {
    file: 'migrations/2026-10-20-add-scan-batch-checkpoints.sql',
    verifyApplied: async (sql) =>
      (await hasTable(sql, 'scan_job_batches')) &&
      (await hasColumn(sql, 'scan_jobs', 'lease_owner')),
  },
  {
    file: 'migrations/2026-11-06-add-live-trade.sql',
    verifyApplied: async (sql) =>
      (await hasTable(sql, 'live_trade_groups')) &&
      (await hasTable(sql, 'live_trade_items')) &&
      (await hasTable(sql, 'live_trade_quote_state')),
  },
  {
    file: 'migrations/2026-11-09-live-trade-allow-repeat-instruments.sql',
    // Applied means the one-per-instrument uniqueness index is gone.
    verifyApplied: async (sql) =>
      (await hasTable(sql, 'live_trade_items')) &&
      !(await hasIndex(sql, 'live_trade_items_owner_instrument_uq')),
  },
  {
    file: 'migrations/2026-11-12-add-internal-identity-foundation.sql',
    verifyApplied: async (sql) =>
      (await hasTable(sql, 'app_users')) &&
      (await hasTable(sql, 'user_identities')) &&
      (await hasTable(sql, 'admin_audit_log')) &&
      (await hasTable(sql, 'instrument_aliases')),
  },
  {
    file: 'migrations/2026-11-12-add-phase1-5-broker-market-data.sql',
    verifyApplied: async (sql) =>
      (await hasTable(sql, 'market_data_connections')) &&
      (await hasTable(sql, 'market_data_oauth_states')) &&
      (await hasTable(sql, 'global_ingestion_locks')),
  },
  {
    file: 'migrations/2026-11-12-add-phase2-firebase-auth.sql',
    verifyApplied: async (sql) =>
      (await hasColumn(sql, 'app_users', 'role')) &&
      (await hasColumn(sql, 'scan_jobs', 'initiator_user_id')) &&
      (await hasTable(sql, 'auth_rate_limits')),
  },
  {
    file: 'migrations/2026-11-13-live-trade-internal-ownership.sql',
    // Not repeatable: ADD CONSTRAINT has no IF NOT EXISTS, so a second run
    // would abort. Detect the fully applied state and skip explicitly.
    verifyApplied: phase3AlreadyApplied,
    partialState: phase3PartiallyApplied,
  },
  {
    file: 'migrations/2026-11-13-phase4-subscriptions.sql',
    verifyApplied: async (sql) =>
      (await hasTable(sql, 'subscription_plans')) &&
      (await hasTable(sql, 'customer_subscriptions')) &&
      (await hasTable(sql, 'payment_records')),
  },
];

const FORBIDDEN_DATA_WRITES = [
  /\bINSERT\b/i,
  /\bUPDATE\s+[\w."]+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bCOPY\b/i,
  /\bMERGE\b/i,
  /\bVACUUM\b/i,
];

const ALLOWED_SHAPES = [
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i,
  /^CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i,
  /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i,
  /^CREATE\s+OR\s+REPLACE\s+FUNCTION\b/i,
  /^ALTER\s+TABLE\b/i,
  /^DROP\s+INDEX\s+IF\s+EXISTS\b/i,
];

const applied = [];

function fail(message) {
  console.error(`ERROR: ${message}`);
  if (applied.length > 0) {
    console.error(`State: applied ${applied.length} file(s): ${applied.join(', ')}`);
  } else {
    console.error('State: no migration statements were applied.');
  }
  process.exit(1);
}

function readApprovedTarget() {
  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production.');
  }
  if (process.env.ALLOW_PHASE5A_MIGRATION !== 'YES') {
    fail('Set ALLOW_PHASE5A_MIGRATION=YES to approve this write.');
  }

  const expectedHost = process.env.EXPECTED_PHASE5A_HOST?.trim();
  if (!expectedHost) {
    fail('EXPECTED_PHASE5A_HOST is required (the authorized development host).');
  }
  if (expectedHost !== AUTHORIZED_HOST) {
    fail('EXPECTED_PHASE5A_HOST does not match the authorized development host.');
  }

  let url = process.env.PHASE5A_DATABASE_URL?.trim() || '';
  let source = url ? 'PHASE5A_DATABASE_URL' : null;

  if (!url) {
    const envFile = process.env.PHASE5A_ENV_FILE?.trim();
    if (!envFile) {
      fail(
        'Set PHASE5A_ENV_FILE=.env.local (development env file) or ' +
          'PHASE5A_DATABASE_URL. This runner never reads DATABASE_URL implicitly.'
      );
    }
    if (path.basename(envFile).toLowerCase() !== '.env.local') {
      fail('PHASE5A_ENV_FILE must name the development env file `.env.local`.');
    }
    const resolved = path.resolve(REPO_ROOT, envFile);
    if (!fs.existsSync(resolved)) {
      fail(`${envFile} does not exist.`);
    }
    const parsed = dotenv.parse(fs.readFileSync(resolved));
    url = (parsed.DATABASE_URL || '').trim();
    source = envFile;
    if (!url) fail(`${envFile} does not define DATABASE_URL.`);
  }

  const target = describeTarget(url);
  if (!target.isNeon) fail('Target must be a Neon Postgres host.');
  if (target.pooled) fail('Use the direct (non-pooler) Neon host for migrations.');
  if (target.host !== AUTHORIZED_HOST) {
    fail(`Target host "${target.host}" is not the authorized development host.`);
  }
  if (target.database !== AUTHORIZED_DATABASE) {
    fail(`Target database "${target.database}" is not ${AUTHORIZED_DATABASE}.`);
  }

  const forbidden = process.env.FORBIDDEN_DATABASE_HOST?.trim();
  if (forbidden && target.host === forbidden) {
    fail('Target host matches FORBIDDEN_DATABASE_HOST.');
  }

  return { url, target, source };
}

async function phase3AlreadyApplied(sql) {
  const cols = await sql.query(
    `SELECT table_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'owner_user_id'
        AND table_name IN ('live_trade_groups','live_trade_items','live_trade_quote_state')`,
    []
  );
  if (cols.length !== 3) return false;
  if (!cols.every((row) => String(row.data_type) === 'uuid')) return false;
  const fks = await sql.query(
    `SELECT t.relname AS table_name
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND c.contype = 'f'
        AND t.relname IN ('live_trade_groups','live_trade_items','live_trade_quote_state')
        AND pg_get_constraintdef(c.oid) ILIKE '%app_users%'`,
    []
  );
  return new Set(fks.map((row) => row.table_name)).size === 3;
}

async function phase3PartiallyApplied(sql) {
  const cols = await sql.query(
    `SELECT table_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'owner_user_id'
        AND table_name IN ('live_trade_groups','live_trade_items','live_trade_quote_state')`,
    []
  );
  if (cols.length === 0) return false;
  if (cols.length !== 3) return true;
  const types = new Set(cols.map((row) => String(row.data_type)));
  if (types.size > 1) return true;
  if (types.has('text')) return false; // legacy state; this file still needs to run
  return !(await phase3AlreadyApplied(sql)); // uuid columns but incomplete FKs
}

async function hasTable(sql, name) {
  const rows = await sql.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

async function hasColumn(sql, table, column) {
  const rows = await sql.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function hasIndex(sql, name) {
  const rows = await sql.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [name]
  );
  return rows.length > 0;
}

/**
 * Finds the first file that still needs to run.
 *
 * A non-empty database is accepted only when it is a verified prefix of this
 * exact chain: every earlier file's objects exist, and no later file's objects
 * do. Anything else is an unexpected state and stops the run without writing.
 */
async function resolveStartIndex(sql) {
  let start = 0;
  while (start < STEPS.length && (await STEPS[start].verifyApplied(sql))) {
    start += 1;
  }

  const expectedTables = new Set(Object.keys(EXPECTED_SCHEMA));
  const tables = await sql.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    []
  );
  const unexpected = tables
    .map((row) => row.table_name)
    .filter((name) => !expectedTables.has(name));
  if (unexpected.length > 0) {
    fail(`Unexpected tables in public schema: ${unexpected.join(', ')}.`);
  }

  if (start === STEPS.length) return start;

  for (let index = start + 1; index < STEPS.length; index += 1) {
    if (await STEPS[index].verifyApplied(sql)) {
      fail(
        `${STEPS[index].file} appears applied while an earlier file ` +
          `(${STEPS[start].file}) does not. Refusing to guess.`
      );
    }
  }

  const current = STEPS[start];
  if (current.partialState && (await current.partialState(sql))) {
    fail(`${current.file} looks partially applied; refusing to continue.`);
  }

  return start;
}

function loadStatements(step) {
  const fullPath = path.join(__dirname, step.file);
  if (!fs.existsSync(fullPath)) fail(`Migration file ${step.file} is missing.`);
  const statements = splitStatements(fs.readFileSync(fullPath, 'utf8'));
  if (statements.length === 0) fail(`${step.file} contains no statements.`);

  for (const [index, statement] of statements.entries()) {
    const shapeOk = ALLOWED_SHAPES.some((pattern) => pattern.test(statement));
    if (!shapeOk) {
      fail(
        `Statement ${index + 1} of ${step.file} is not a reviewed DDL shape. ` +
          'Refusing to execute.'
      );
    }
    const writeHit = FORBIDDEN_DATA_WRITES.find((pattern) => pattern.test(statement));
    if (writeHit) {
      fail(
        `Statement ${index + 1} of ${step.file} contains a data-writing ` +
          'keyword. Refusing to execute.'
      );
    }
  }

  return statements;
}

async function verifySchemaAndStructure(sql) {
  const expectedTables = Object.keys(EXPECTED_SCHEMA).sort();

  const tableRows = await sql.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    []
  );
  const actualTables = tableRows.map((row) => row.table_name);
  const unexpected = actualTables.filter((name) => !expectedTables.includes(name));
  const missing = expectedTables.filter((name) => !actualTables.includes(name));
  if (missing.length > 0) fail(`Missing tables: ${missing.join(', ')}.`);
  if (unexpected.length > 0) fail(`Unexpected tables: ${unexpected.join(', ')}.`);
  console.log(`ok  tables (${actualTables.length} expected tables present, none extra)`);

  const columnRows = await sql.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [expectedTables]
  );
  const byTable = new Map();
  for (const row of columnRows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name).add(row.column_name);
  }
  let columnCount = 0;
  for (const [table, columns] of Object.entries(EXPECTED_SCHEMA)) {
    const have = byTable.get(table) || new Set();
    const absent = columns.filter((column) => !have.has(column));
    if (absent.length > 0) {
      fail(`${table} is missing columns: ${absent.join(', ')}.`);
    }
    columnCount += columns.length;
  }
  console.log(`ok  columns (${columnCount} expected columns present)`);

  const dupIndexes = await sql.query(
    `SELECT tablename, indexdef, count(*)::int AS n, string_agg(indexname, ',') AS names
       FROM pg_indexes
      WHERE schemaname = 'public'
      GROUP BY tablename, indexdef
     HAVING count(*) > 1`,
    []
  );
  if (dupIndexes.length > 0) {
    fail(
      'Duplicate index definitions: ' +
        dupIndexes.map((row) => `${row.tablename}=${row.names}`).join('; ')
    );
  }

  const dupConstraints = await sql.query(
    `SELECT t.relname AS table_name, pg_get_constraintdef(c.oid) AS def,
            count(*)::int AS n
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
      GROUP BY 1, 2
     HAVING count(*) > 1`,
    []
  );
  if (dupConstraints.length > 0) {
    fail('Duplicate constraint definitions were created.');
  }
  console.log('ok  no duplicate index or constraint objects');

  const indexes = await sql.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    []
  );
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const requiredIndexes = [
    'idx_daily_candles_instr_date',
    'idx_zones_instrument_timeframe',
    'idx_zone_events_zone_type',
    'idx_scan_jobs_status',
    'idx_agg_candles_instrument_timeframe',
    'idx_agg_candles_period_start',
    'idx_hourly_candles_instr_ts',
    'idx_4h_candles_instr_ts',
    'idx_candle_coverage_tf',
    'idx_backfill_jobs_status',
    'idx_backfill_jobs_instr_tf',
    'idx_nifty500_effective',
    'idx_zones_composite',
    'idx_zones_distance',
    'idx_zone_events_historical',
    'idx_hourly_candles_instr_ts',
    'idx_scan_jobs_status_lease',
    'idx_scan_job_batches_job_stage',
    'live_trade_groups_owner_name_uq',
    'live_trade_groups_owner_sort_idx',
    'live_trade_items_owner_sort_idx',
    'live_trade_items_owner_group_idx',
    'live_trade_items_instrument_idx',
    'app_users_email_lower_uq',
    'app_users_status_created_idx',
    'user_identities_user_idx',
    'admin_audit_log_created_idx',
    'admin_audit_log_actor_created_idx',
    'admin_audit_log_target_idx',
    'instrument_aliases_instrument_idx',
    'instrument_aliases_provider_symbol_idx',
    'market_data_connections_provider_status_idx',
    'market_data_oauth_states_expires_idx',
    'global_ingestion_locks_lease_expires_idx',
    'idx_scan_jobs_initiator_status',
    'idx_auth_rate_limits_updated_at',
    'kite_session_bindings_user_idx',
    'subscription_plans_name_lower_uq',
    'subscription_plans_status_created_idx',
    'customer_subscriptions_user_status_idx',
    'customer_subscriptions_user_end_idx',
    'customer_subscriptions_plan_idx',
    'customer_subscriptions_renewed_from_idx',
    'payment_records_user_date_idx',
    'payment_records_subscription_idx',
  ];
  const missingIndexes = requiredIndexes.filter((name) => !indexNames.has(name));
  if (missingIndexes.length > 0) {
    fail(`Missing indexes: ${[...new Set(missingIndexes)].join(', ')}.`);
  }
  if (indexNames.has('live_trade_items_owner_instrument_uq')) {
    fail(
      'live_trade_items_owner_instrument_uq still exists; repeat-instrument ' +
        'entries would be blocked.'
    );
  }
  console.log('ok  required indexes present; repeat-instrument uniqueness removed');

  const ownerColumns = await sql.query(
    `SELECT table_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'owner_user_id'
        AND table_name IN ('live_trade_groups','live_trade_items','live_trade_quote_state')`,
    []
  );
  const ownerOk =
    ownerColumns.length === 3 &&
    ownerColumns.every((row) => row.data_type === 'uuid' && row.is_nullable === 'NO');
  if (!ownerOk) {
    fail('Live Trade owner_user_id must be UUID NOT NULL on all three tables.');
  }
  console.log('ok  Live Trade ownership is UUID NOT NULL on all three tables');

  const fks = await sql.query(
    `SELECT t.relname AS table_name, c.conname,
            pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND c.contype = 'f'`,
    []
  );
  const expectFk = (table, pattern, label) => {
    const found = fks.some(
      (row) => row.table_name === table && pattern.test(String(row.def))
    );
    if (!found) fail(`Missing foreign key: ${label}.`);
  };
  expectFk('live_trade_groups', /REFERENCES app_users\(user_id\) ON DELETE CASCADE/, 'live_trade_groups.owner_user_id → app_users (CASCADE)');
  expectFk('live_trade_items', /REFERENCES app_users\(user_id\) ON DELETE CASCADE/, 'live_trade_items.owner_user_id → app_users (CASCADE)');
  expectFk('live_trade_quote_state', /REFERENCES app_users\(user_id\) ON DELETE CASCADE/, 'live_trade_quote_state.owner_user_id → app_users (CASCADE)');
  expectFk('live_trade_items', /FOREIGN KEY \(group_id, owner_user_id\) REFERENCES live_trade_groups\(group_id, owner_user_id\)/, 'live_trade_items (group_id, owner_user_id) → live_trade_groups');
  expectFk('kite_session_bindings', /REFERENCES kite_sessions\(session_id_hash\) ON DELETE CASCADE/, 'kite_session_bindings.session_id_hash → kite_sessions (CASCADE)');
  expectFk('kite_session_bindings', /REFERENCES app_users\(user_id\) ON DELETE CASCADE/, 'kite_session_bindings.app_user_id → app_users (CASCADE)');
  expectFk('user_identities', /REFERENCES app_users\(user_id\) ON DELETE CASCADE/, 'user_identities.user_id → app_users (CASCADE)');
  expectFk('admin_audit_log', /REFERENCES app_users\(user_id\) ON DELETE SET NULL/, 'admin_audit_log.actor_user_id → app_users (SET NULL)');
  expectFk('scan_jobs', /REFERENCES app_users\(user_id\) ON DELETE SET NULL/, 'scan_jobs.initiator_user_id → app_users (SET NULL)');
  expectFk('instrument_aliases', /REFERENCES instruments\(instrument_id\) ON DELETE RESTRICT/, 'instrument_aliases.instrument_id → instruments (RESTRICT)');
  expectFk('customer_subscriptions', /REFERENCES app_users\(user_id\) ON DELETE CASCADE/, 'customer_subscriptions.user_id → app_users (CASCADE)');
  expectFk('customer_subscriptions', /REFERENCES subscription_plans\(plan_id\) ON DELETE RESTRICT/, 'customer_subscriptions.plan_id → subscription_plans (RESTRICT)');
  expectFk('payment_records', /FOREIGN KEY \(subscription_id, user_id\) REFERENCES customer_subscriptions\(subscription_id, user_id\) ON DELETE RESTRICT/, 'payment_records (subscription_id, user_id) → customer_subscriptions (RESTRICT)');
  expectFk('payment_records', /REFERENCES app_users\(user_id\) ON DELETE RESTRICT/, 'payment_records.user_id → app_users (RESTRICT)');
  console.log('ok  all expected foreign keys present with the intended delete actions');

  const constraints = await sql.query(
    `SELECT t.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'`,
    []
  );
  const constraintNames = new Set(constraints.map((row) => `${row.table_name}.${row.conname}`));
  const requiredConstraints = [
    'live_trade_groups.live_trade_groups_group_owner_uq',
    'live_trade_items.live_trade_items_group_owner_fk',
    'app_users.app_users_status_chk',
    'user_identities.user_identities_provider_user_uq',
    'market_data_connections.market_data_connections_designation_system',
    'market_data_connections.market_data_connections_designation_provider_uq',
    'customer_subscriptions.customer_subscriptions_id_user_uq',
    'customer_subscriptions.customer_subscriptions_dates_chk',
    'customer_subscriptions.customer_subscriptions_status_chk',
    'payment_records.payment_records_subscription_owner_fk',
    'payment_records.payment_records_amount_chk',
    'payment_records.payment_records_status_chk',
    'subscription_plans.subscription_plans_status_chk',
    'scan_jobs.scan_jobs_config_id_fkey',
    'scan_job_batches.scan_job_batches_job_id_fkey',
  ];
  const missingConstraints = requiredConstraints.filter((name) => !constraintNames.has(name));
  if (missingConstraints.length > 0) {
    fail(`Missing constraints: ${missingConstraints.join(', ')}.`);
  }
  const roleCheck = constraints.some(
    (row) =>
      row.table_name === 'app_users' &&
      /SUPER_ADMIN/.test(String(row.def)) &&
      /CUSTOMER/.test(String(row.def))
  );
  if (!roleCheck) fail('app_users.role does not constrain SUPER_ADMIN/ADMIN/CUSTOMER.');
  console.log('ok  expected unique/check/foreign-key constraints present');

  const fn = await sql.query(
    `SELECT p.proname, pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'is_subscription_entitled'`,
    []
  );
  if (fn.length !== 1) fail('is_subscription_entitled() must exist exactly once.');
  if (!/Asia\/Kolkata/.test(String(fn[0].definition))) {
    fail('is_subscription_entitled() does not evaluate Asia/Kolkata dates.');
  }
  console.log('ok  is_subscription_entitled(user_id, at) present with IST predicate');

  const marketDataColumns = await sql.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'market_data_connections'`,
    []
  );
  if (marketDataColumns.some((row) => row.column_name === 'user_id')) {
    fail('market_data_connections must not be owned by a customer user_id.');
  }
  console.log('ok  system market-data connection schema has no customer owner column');

  const emptyTables = [
    'app_users',
    'user_identities',
    'subscription_plans',
    'customer_subscriptions',
    'payment_records',
  ];
  for (const table of emptyTables) {
    const rows = await sql.query(`SELECT count(*)::int AS n FROM ${table}`, []);
    if (Number(rows[0].n) !== 0) {
      fail(`${table} is not empty; this phase must not create customer records.`);
    }
  }
  console.log('ok  no identity, plan, subscription or payment rows were created');
}

async function main() {
  const { url, target, source } = readApprovedTarget();

  console.log(
    `Database target: host=${target.host} database=${target.database} ` +
      `sslmode=${target.sslmode} source=${source} (credentials omitted)`
  );
  console.log(`Migration chain: ${STEPS.length} files, dependency order`);

  const { neon } = require('@neondatabase/serverless');
  const sql = neon(url);

  const startIndex = await resolveStartIndex(sql);
  if (startIndex === 0) {
    console.log('ok  public schema is empty (initial state verified)');
  } else if (startIndex === STEPS.length) {
    console.log('ok  every file in the chain is already applied; nothing to execute');
  } else {
    console.log(
      `ok  verified ${startIndex} already-applied file(s); ` +
        `resuming at ${STEPS[startIndex].file}`
    );
  }

  for (let index = startIndex; index < STEPS.length; index += 1) {
    const step = STEPS[index];
    const label = `[${index + 1}/${STEPS.length}] ${step.file}`;

    if (step.partialState && (await step.partialState(sql))) {
      fail(`${step.file} looks partially applied; refusing to continue.`);
    }
    if (await step.verifyApplied(sql)) {
      console.log(`${label} — already applied (not repeatable); skipping`);
      applied.push(step.file);
      continue;
    }

    const statements = loadStatements(step);
    console.log(`${label} — applying ${statements.length} statement(s) …`);
    const startedAt = Date.now();
    for (const [statementIndex, statement] of statements.entries()) {
      try {
        await sql.query(statement, []);
      } catch (error) {
        const snippet = statement.replace(/\s+/g, ' ').slice(0, 160);
        console.error(
          `\nFAILED ${step.file} at statement ${statementIndex + 1}/${statements.length}`
        );
        console.error(`  SQL: ${snippet}${statement.length > 160 ? ' …' : ''}`);
        console.error(`  PostgreSQL: ${sqlErrorMessage(error)}`);
        console.error(
          `  State: earlier statements in this file are committed; files after ` +
            `this one were not applied.`
        );
        fail(`Migration stopped at ${step.file}.`);
      }
    }
    applied.push(step.file);
    console.log(`    ok (${Date.now() - startedAt} ms)`);
  }

  console.log('\nVerifying final schema …');
  await verifySchemaAndStructure(sql);

  const indexCount = await sql.query(
    `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`,
    []
  );
  const constraintCount = await sql.query(
    `SELECT count(*)::int AS n FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`,
    []
  );
  console.log(
    `\nPhase 5A initialization complete: ${STEPS.length} files applied, ` +
      `${indexCount[0].n} indexes, ${constraintCount[0].n} constraints verified.`
  );
}

function sqlErrorMessage(error) {
  if (!error) return 'unknown error';
  const parts = [error.message || String(error)];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.detail) parts.push(`detail=${String(error.detail).slice(0, 200)}`);
  return parts.join(' | ');
}

main().catch((error) => {
  console.error(
    'Phase 5A initialization failed:',
    sqlErrorMessage(error)
  );
  process.exit(1);
});
