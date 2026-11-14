/**
 * DemandScan — shared schema contract.
 *
 * Single source of truth for the tables/columns the application code requires.
 * Consumed by:
 *   - db/verify-schema.js   (read-only check against a live database)
 *   - __tests__/scanner/schema.test.ts (asserts the repo migrations actually
 *     create everything the code expects)
 *   - db/migrate-phase5a.js (only the Phase 5A subset, see below)
 *
 * Every entry here MUST be backed by a CREATE TABLE / ALTER TABLE statement in
 * db/schema.sql or db/migrations/*.sql. The test suite enforces that.
 *
 * Phase ownership:
 *   Phase 5A initializes every table except the ones listed in
 *   POST_PHASE5A_TABLES. Its final verification uses PHASE5A_EXPECTED_SCHEMA,
 *   so a Phase 5A-only database is valid without later-phase tables. The full
 *   EXPECTED_SCHEMA (consumed by db:verify and the Signals runner) still
 *   requires every table, including Signals.
 */

const POST_PHASE5A_TABLES = [
  'signals',
  'signal_recipients',
  'signal_email_attempts',
];

const EXPECTED_SCHEMA = {
  // db/schema.sql
  kite_sessions: [
    'session_id_hash',
    'encrypted_access_token',
    'user_id',
    'user_name',
    'email',
    'login_time',
    'expires_at',
    'created_at',
  ],

  // 2024-10-18-add-scanner-schema.sql
  instruments: [
    'instrument_id',
    'symbol',
    'exchange',
    'company_name',
    'active',
    'source',
    'updated_at',
  ],
  daily_candles: [
    'instrument_id',
    'candle_date',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'source',
    'fetched_at',
  ],
  scanner_configs: ['config_id', 'version', 'created_at', 'config_json'],
  zones: [
    'zone_id',
    'instrument_id',
    'timeframe',
    'pattern',
    'side',
    'base_start',
    'base_end',
    'leg_in_ts',
    'leg_out_ts',
    'zone_low',
    'zone_high',
    'proximal',
    'distal',
    'formation_ts',
    'config_version',
    'score',
    'lifecycle_state',
    'last_touch_ts',
    'touch_count',
    'created_at',
    // v1 composite scoring columns
    'composite_score',
    'score_components',
    'distance_pct',
    'confluence_score',
    'opposition_risk',
    'data_quality_score',
  ],
  zone_events: [
    'event_id',
    'zone_id',
    'event_type',
    'candle_ts',
    'details_json',
    'recorded_at',
    // v1 historical replay columns
    'is_historical',
    'as_of_date',
  ],
  scan_jobs: [
    'job_id',
    'started_at',
    'completed_at',
    'status',
    'progress_percent',
    'error_message',
    'config_id',
    // 2026-10-20 resumable batch checkpoints
    'session_id_hash',
    'from_date',
    'to_date',
    'concurrency',
    'current_stage',
    'cursor_instrument_id',
    'instrument_ids',
    'requested_symbols',
    'retry_count',
    'max_retries',
    'lease_owner',
    'lease_expires_at',
    'total_instruments',
    'processed_instruments',
    // 2026-11-12 Phase 2 Firebase authentication
    'initiator_user_id',
  ],
  ingestion_checkpoints: ['instrument_id', 'last_candle_date', 'updated_at'],

  // 2024-10-18-add-aggregation-schema.sql
  aggregated_candles: [
    'agg_id',
    'instrument_token',
    'timeframe',
    'period_start',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'created_at',
  ],

  // 2024-10-18-v1-intraday-scoring-history.sql
  hourly_candles: [
    'instrument_id',
    'candle_ts',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'is_session_complete',
    'source',
    'fetched_at',
  ],
  four_hour_candles: [
    'instrument_id',
    'session_ts',
    'session_label',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'candle_count',
    'is_complete',
    'source',
  ],
  candle_coverage: [
    'instrument_id',
    'timeframe',
    'first_candle',
    'last_candle',
    'total_candles',
    'missing_gaps',
    'last_updated',
  ],
  backfill_jobs: [
    'job_id',
    'instrument_id',
    'timeframe',
    'from_date',
    'to_date',
    'last_processed_ts',
    'status',
    'candles_processed',
    'zones_formed',
    'error_message',
    'started_at',
    'completed_at',
  ],
  nifty500_membership: [
    'instrument_id',
    'effective_from',
    'effective_to',
    'added_reason',
    'removed_reason',
  ],
  hourly_ingestion_checkpoints: ['instrument_id', 'last_candle_ts', 'updated_at'],

  // 2026-10-20-add-scan-batch-checkpoints.sql
  scan_job_batches: [
    'batch_id',
    'job_id',
    'stage',
    'cursor_start',
    'cursor_end',
    'instrument_ids',
    'status',
    'attempt',
    'error_message',
    'lease_owner',
    'started_at',
    'completed_at',
  ],

  // 2026-11-06-add-live-trade.sql
  live_trade_groups: [
    'group_id',
    'owner_user_id',
    'name',
    'sort_order',
    'version',
    'created_at',
    'updated_at',
  ],
  live_trade_items: [
    'item_id',
    'owner_user_id',
    'instrument_id',
    'group_id',
    'priority',
    'direction',
    'timeframe',
    'entry_price',
    'target_price',
    'stop_loss',
    'notes',
    'trade_status',
    'sort_order',
    'version',
    'created_at',
    'updated_at',
  ],
  live_trade_quote_state: [
    'owner_user_id',
    'last_request_at',
    'updated_at',
  ],

  // 2026-11-13-live-trade-internal-ownership.sql
  kite_session_bindings: [
    'session_id_hash',
    'app_user_id',
    'created_at',
  ],

  // 2026-11-12-add-internal-identity-foundation.sql
  app_users: [
    'user_id',
    'email',
    'display_name',
    'status',
    // 2026-11-12 Phase 2 Firebase authentication
    'role',
    'created_at',
    'updated_at',
  ],
  user_identities: [
    'identity_id',
    'user_id',
    'provider',
    'provider_user_id',
    'created_at',
    'updated_at',
  ],
  admin_audit_log: [
    'audit_id',
    'actor_user_id',
    'action',
    'target_entity_type',
    'target_entity_id',
    'metadata',
    'created_at',
  ],
  instrument_aliases: [
    'alias_id',
    'instrument_id',
    'provider',
    'provider_instrument_key',
    'exchange',
    'trading_symbol',
    'instrument_type',
    'segment',
    'created_at',
    'updated_at',
  ],

  // 2026-11-12-add-phase1-5-broker-market-data.sql
  market_data_connections: [
    'connection_id',
    'provider',
    'designation',
    'label',
    'encrypted_access_token',
    'encrypted_refresh_token',
    'token_expires_at',
    'status',
    'provider_metadata',
    'last_successful_use_at',
    'created_at',
    'updated_at',
  ],
  market_data_oauth_states: [
    'state_hash',
    'provider',
    'created_at',
    'expires_at',
    'consumed_at',
  ],
  global_ingestion_locks: [
    'lock_name',
    'lease_owner',
    'acquired_at',
    'heartbeat_at',
    'lease_expires_at',
    'released_at',
  ],

  // 2026-11-12-add-phase2-firebase-auth.sql
  auth_rate_limits: [
    'rate_key',
    'window_started_at',
    'attempt_count',
    'updated_at',
  ],

  // 2026-11-13-phase4-subscriptions.sql
  subscription_plans: [
    'plan_id',
    'name',
    'description',
    'duration_days',
    'price',
    'currency',
    'status',
    'created_at',
    'updated_at',
  ],
  customer_subscriptions: [
    'subscription_id',
    'user_id',
    'plan_id',
    'start_date',
    'end_date',
    'status',
    'created_by',
    'activated_at',
    'activated_by',
    'cancelled_at',
    'cancelled_by',
    'cancellation_reason',
    'renewed_from_subscription_id',
    'created_at',
    'updated_at',
  ],
  payment_records: [
    'payment_id',
    'user_id',
    'subscription_id',
    'amount',
    'currency',
    'payment_method',
    'payment_reference',
    'payment_date',
    'payment_status',
    'notes',
    'recorded_by',
    'created_at',
  ],

  // 2026-11-14-add-signals.sql (+ 2026-11-15 fingerprint migration)
  signals: [
    'signal_id',
    'message',
    'created_by',
    'created_at',
    'published_at',
    'status',
    'idempotency_key',
    'idempotency_fingerprint',
  ],
  signal_recipients: [
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
  ],
  signal_email_attempts: [
    'attempt_id',
    'recipient_id',
    'attempted_at',
    'outcome',
    'error_code',
    'error_message',
  ],
};

// Phase 5A owns every table except the post-Phase-5A additions above.
const PHASE5A_EXPECTED_SCHEMA = Object.fromEntries(
  Object.entries(EXPECTED_SCHEMA).filter(
    ([table]) => !POST_PHASE5A_TABLES.includes(table)
  )
);

module.exports = {
  EXPECTED_SCHEMA,
  PHASE5A_EXPECTED_SCHEMA,
  POST_PHASE5A_TABLES,
};
