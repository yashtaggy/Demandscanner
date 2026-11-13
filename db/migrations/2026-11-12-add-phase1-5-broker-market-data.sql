-- 2026-11-12 Phase 1.5 — broker abstraction and system market-data separation.
--
-- Additive and idempotent. This migration ONLY creates new tables, constraints
-- and indexes. It does not alter, rename, drop, truncate or delete any existing
-- table, column, row, index or value.
--
-- Scope:
--   * market_data_connections   operator-owned SYSTEM market-data credentials
--   * market_data_oauth_states  single-use OAuth state for the operator flow
--   * global_ingestion_locks    cross-request ingestion lease (Postgres only)
--
-- Ownership rules:
--   market_data_connections deliberately has NO user_id column. System market
--   data credentials are never owned by, scoped to, or readable by a customer.
--   The `designation` column is constrained to SYSTEM precisely so this table
--   cannot silently become a per-customer broker-connection table. Customer
--   broker connections (if ever introduced) must use their own table with a
--   non-nullable owner id.
--
-- Credential rules:
--   Tokens are stored only as AES-256-GCM ciphertext, bound to the connection
--   id and provider through additional authenticated data (AAD). Plaintext
--   credentials are never stored. provider_metadata is a JSON object holding
--   non-secret provider metadata only (for example the Kite API key, which is a
--   public application identifier, not a secret).
--
-- Explicitly NOT in this migration:
--   * Upstox OAuth, token exchange or customer broker connections.
--   * Firebase authentication, sessions, subscriptions or payments.
--   * Any change to instruments, candles, zones or Live Trade tables.

-- ─── System market-data connections ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_data_connections (
  connection_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                  TEXT        NOT NULL,
  designation               TEXT        NOT NULL DEFAULT 'SYSTEM',
  label                     TEXT,
  encrypted_access_token    TEXT        NOT NULL,
  encrypted_refresh_token   TEXT,
  token_expires_at          TIMESTAMPTZ,
  status                    TEXT        NOT NULL DEFAULT 'ACTIVE',
  provider_metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_successful_use_at    TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_data_connections_provider_supported
    CHECK (provider IN ('KITE', 'UPSTOX')),
  CONSTRAINT market_data_connections_designation_system
    CHECK (designation = 'SYSTEM'),
  CONSTRAINT market_data_connections_status_chk
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR')),
  CONSTRAINT market_data_connections_label_len
    CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT market_data_connections_access_token_not_blank
    CHECK (btrim(encrypted_access_token) <> ''),
  CONSTRAINT market_data_connections_metadata_object
    CHECK (jsonb_typeof(provider_metadata) = 'object'),
  CONSTRAINT market_data_connections_designation_provider_uq
    UNIQUE (designation, provider)
);

CREATE INDEX IF NOT EXISTS market_data_connections_provider_status_idx
  ON market_data_connections (provider, status);

-- ─── Single-use OAuth state for the operator connection flow ─────────────────
--
-- Only the SHA-256 hash of the state is stored. The plaintext state lives in an
-- HttpOnly cookie for the duration of the redirect and is never persisted.

CREATE TABLE IF NOT EXISTS market_data_oauth_states (
  state_hash   TEXT        PRIMARY KEY,
  provider     TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  CONSTRAINT market_data_oauth_states_hash_len
    CHECK (char_length(state_hash) = 64),
  CONSTRAINT market_data_oauth_states_provider_supported
    CHECK (provider IN ('KITE', 'UPSTOX')),
  CONSTRAINT market_data_oauth_states_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS market_data_oauth_states_expires_idx
  ON market_data_oauth_states (expires_at);

-- ─── Global ingestion lease ──────────────────────────────────────────────────
--
-- Database-backed so concurrent scan initiations across serverless instances
-- cannot both call the market-data provider. A lease is reclaimable only after
-- it expires, which provides stale-lock recovery without an in-memory singleton.

CREATE TABLE IF NOT EXISTS global_ingestion_locks (
  lock_name         TEXT        PRIMARY KEY,
  lease_owner       TEXT        NOT NULL,
  acquired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at  TIMESTAMPTZ NOT NULL,
  released_at       TIMESTAMPTZ,
  CONSTRAINT global_ingestion_locks_name_not_blank
    CHECK (btrim(lock_name) <> ''),
  CONSTRAINT global_ingestion_locks_name_len
    CHECK (char_length(lock_name) <= 120),
  CONSTRAINT global_ingestion_locks_owner_not_blank
    CHECK (btrim(lease_owner) <> ''),
  CONSTRAINT global_ingestion_locks_owner_len
    CHECK (char_length(lease_owner) <= 200),
  CONSTRAINT global_ingestion_locks_lease_after_acquired
    CHECK (lease_expires_at > acquired_at)
);

CREATE INDEX IF NOT EXISTS global_ingestion_locks_lease_expires_idx
  ON global_ingestion_locks (lease_expires_at);
