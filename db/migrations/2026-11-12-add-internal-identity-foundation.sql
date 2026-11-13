-- 2026-11-12 Phase 1 — internal identity and provider-mapping foundation.
--
-- Additive and idempotent. This migration ONLY creates new tables, constraints
-- and indexes. It does not alter, rename, drop, truncate or delete any existing
-- table, column, row, index or value.
--
-- Scope:
--   * app_users            internal DemandScan users (ownership identifier)
--   * user_identities      authentication-provider identity -> internal user
--   * admin_audit_log      administrative audit trail
--   * instrument_aliases   provider-specific keys for an existing instrument
--
-- Explicitly NOT in this migration:
--   * Firebase authentication, Firebase Admin SDK integration or sessions.
--   * Upstox OAuth or token storage.
--   * Subscription, plan, payment or expiry tables.
--   * Any change to instruments.instrument_id or any existing instrument row.
--
-- Ownership rules:
--   app_users.user_id (UUID) is the future ownership identifier for
--   customer-specific records. Provider user ids (Firebase UID) are stored only
--   in user_identities and never become application ownership ids.
--
-- No passwords, access tokens, API secrets or other credentials are stored in
-- these tables. admin_audit_log.metadata is an arbitrary JSON object and must
-- never contain credentials; that is enforced by application code, because SQL
-- cannot reliably inspect credential-shaped content.

-- ─── Internal DemandScan users ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_users (
  user_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL,
  display_name  TEXT,
  status        TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_users_email_not_blank
    CHECK (btrim(email) <> ''),
  CONSTRAINT app_users_email_len
    CHECK (char_length(email) <= 320),
  CONSTRAINT app_users_display_name_len
    CHECK (
      display_name IS NULL OR
      char_length(btrim(display_name)) BETWEEN 1 AND 120
    ),
  CONSTRAINT app_users_status_chk
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED'))
);

-- Case-insensitive email uniqueness. The expression matches the lookup form
-- used by the application: lower(btrim(email)).
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_uq
  ON app_users (lower(btrim(email)));

CREATE INDEX IF NOT EXISTS app_users_status_created_idx
  ON app_users (status, created_at DESC);

-- ─── Authentication-provider identities ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_identities (
  identity_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  provider          TEXT        NOT NULL,
  provider_user_id  TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_identities_provider_not_blank
    CHECK (btrim(provider) <> ''),
  CONSTRAINT user_identities_provider_supported
    CHECK (provider IN ('FIREBASE')),
  CONSTRAINT user_identities_provider_user_not_blank
    CHECK (btrim(provider_user_id) <> ''),
  CONSTRAINT user_identities_provider_user_len
    CHECK (char_length(provider_user_id) <= 128),
  CONSTRAINT user_identities_provider_user_uq
    UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS user_identities_user_idx
  ON user_identities (user_id);

-- ─── Administrative audit trail ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_audit_log (
  audit_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id        UUID        REFERENCES app_users(user_id) ON DELETE SET NULL,
  action               TEXT        NOT NULL,
  target_entity_type   TEXT        NOT NULL,
  target_entity_id     TEXT,
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_audit_log_action_not_blank
    CHECK (btrim(action) <> ''),
  CONSTRAINT admin_audit_log_action_len
    CHECK (char_length(action) <= 80),
  CONSTRAINT admin_audit_log_target_type_not_blank
    CHECK (btrim(target_entity_type) <> ''),
  CONSTRAINT admin_audit_log_target_type_len
    CHECK (char_length(target_entity_type) <= 60),
  CONSTRAINT admin_audit_log_target_id_len
    CHECK (target_entity_id IS NULL OR char_length(target_entity_id) <= 200),
  CONSTRAINT admin_audit_log_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_created_idx
  ON admin_audit_log (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON admin_audit_log (target_entity_type, target_entity_id, created_at DESC);

-- ─── Provider-specific instrument aliases ────────────────────────────────────
--
-- instruments.instrument_id remains the application's canonical numeric id and
-- MUST NOT be renamed, renumbered, replaced or deleted. An alias maps that
-- existing id to a broker-specific key. One instrument may have several
-- aliases (for example one KITE alias and one UPSTOX alias). Kite tokens and
-- Upstox instrument keys are not interchangeable and are never compared.

CREATE TABLE IF NOT EXISTS instrument_aliases (
  alias_id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id            BIGINT      NOT NULL REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
  provider                 TEXT        NOT NULL,
  provider_instrument_key  TEXT        NOT NULL,
  exchange                 TEXT        NOT NULL,
  trading_symbol           TEXT        NOT NULL,
  instrument_type          TEXT,
  segment                  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT instrument_aliases_provider_supported
    CHECK (provider IN ('KITE', 'UPSTOX')),
  CONSTRAINT instrument_aliases_provider_key_not_blank
    CHECK (btrim(provider_instrument_key) <> ''),
  CONSTRAINT instrument_aliases_provider_key_len
    CHECK (char_length(provider_instrument_key) <= 200),
  CONSTRAINT instrument_aliases_exchange_not_blank
    CHECK (btrim(exchange) <> ''),
  CONSTRAINT instrument_aliases_exchange_len
    CHECK (char_length(exchange) <= 32),
  CONSTRAINT instrument_aliases_symbol_not_blank
    CHECK (btrim(trading_symbol) <> ''),
  CONSTRAINT instrument_aliases_symbol_len
    CHECK (char_length(trading_symbol) <= 64),
  CONSTRAINT instrument_aliases_type_len
    CHECK (instrument_type IS NULL OR char_length(instrument_type) <= 32),
  CONSTRAINT instrument_aliases_segment_len
    CHECK (segment IS NULL OR char_length(segment) <= 32),
  CONSTRAINT instrument_aliases_provider_key_uq
    UNIQUE (provider, provider_instrument_key)
);

CREATE INDEX IF NOT EXISTS instrument_aliases_instrument_idx
  ON instrument_aliases (instrument_id);

CREATE INDEX IF NOT EXISTS instrument_aliases_provider_symbol_idx
  ON instrument_aliases (provider, trading_symbol);
