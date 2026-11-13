-- DemandScan — Phase 2 Firebase authentication
--
-- Additive only. Every statement is safe to re-run:
--   * role is added with a default so existing rows become CUSTOMER.
--   * scan_jobs gains an app-user owner without touching existing rows.
--   * auth_rate_limits is a new table used to throttle login/session and
--     provisioning attempts.
--
-- app_users remains the ownership root. Firebase UIDs live only in
-- user_identities.provider_user_id and are never used as ownership keys.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'CUSTOMER'
    CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'CUSTOMER'));

ALTER TABLE scan_jobs
  ADD COLUMN IF NOT EXISTS initiator_user_id UUID
    REFERENCES app_users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scan_jobs_initiator_status
  ON scan_jobs (initiator_user_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key          TEXT        PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count     INTEGER     NOT NULL CHECK (attempt_count >= 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at
  ON auth_rate_limits (updated_at);
