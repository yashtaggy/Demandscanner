-- 2026-11-14 Signals — signal publication, recipient outbox and delivery attempts.
--
-- Additive and idempotent. Creates three new tables and their indexes. It does
-- not alter, rename, drop, truncate or delete any existing table, column, row,
-- index or constraint.
--
-- Scope:
--   * signals                published super-admin messages
--   * signal_recipients      per-customer snapshot AND persistent email outbox
--   * signal_email_attempts  append-only delivery diagnostics
--
-- Recipient semantics:
--   A recipient row is created at publication for every eligible CUSTOMER whose
--   app_users.status is ACTIVE. Subscription state is never consulted. The
--   customer's email address is snapshotted here so later account changes
--   cannot rewrite delivery history.
--
-- Message semantics:
--   message is stored exactly as submitted, including whitespace, line breaks
--   and Unicode emoji. Only blank messages, messages longer than 10,000
--   characters and unsupported control characters are rejected.
--
-- Retention:
--   signals and signal_recipients are retained indefinitely. Only the optional
--   signal_email_attempts diagnostics may later be pruned (90-day policy); no
--   pruning is implemented in this phase.
--
-- No credential, SMTP transport detail, message body copy or connection string
-- is stored in signal_email_attempts.

-- ─── Published signals ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signals (
  signal_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message         TEXT        NOT NULL,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT        NOT NULL DEFAULT 'PUBLISHED',
  idempotency_key TEXT,
  CONSTRAINT signals_created_by_fk
    FOREIGN KEY (created_by) REFERENCES app_users(user_id) ON DELETE SET NULL,
  CONSTRAINT signals_message_not_blank
    CHECK (message ~ '[^[:space:]]'),
  CONSTRAINT signals_message_len
    CHECK (char_length(message) <= 10000),
  CONSTRAINT signals_message_control_chk
    CHECK (translate(message, E'\n\r\t', '') !~ '[[:cntrl:]]'),
  CONSTRAINT signals_status_chk
    CHECK (status IN ('PUBLISHED', 'ARCHIVED')),
  CONSTRAINT signals_idempotency_len
    CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128)
);

-- At most one signal per creator for a given non-null idempotency key. Two
-- different creators may use the same key.
CREATE UNIQUE INDEX IF NOT EXISTS signals_created_by_idempotency_uq
  ON signals (created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_published_idx
  ON signals (published_at DESC);

-- ─── Recipients and email outbox ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signal_recipients (
  recipient_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id              UUID        NOT NULL,
  user_id                UUID        NOT NULL,
  email_address          TEXT        NOT NULL,
  read_at                TIMESTAMPTZ,
  email_status           TEXT        NOT NULL DEFAULT 'PENDING',
  email_attempts         INTEGER     NOT NULL DEFAULT 0,
  email_next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_last_attempt_at  TIMESTAMPTZ,
  email_sent_at          TIMESTAMPTZ,
  email_error            TEXT,
  email_lease_owner      TEXT,
  email_lease_expires_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_recipients_signal_user_uq
    UNIQUE (signal_id, user_id),
  CONSTRAINT signal_recipients_signal_fk
    FOREIGN KEY (signal_id) REFERENCES signals(signal_id) ON DELETE CASCADE,
  CONSTRAINT signal_recipients_user_fk
    FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT signal_recipients_email_chk
    CHECK (email_address ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  CONSTRAINT signal_recipients_email_len
    CHECK (char_length(email_address) <= 320),
  CONSTRAINT signal_recipients_email_status_chk
    CHECK (email_status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT signal_recipients_attempts_chk
    CHECK (email_attempts >= 0),
  CONSTRAINT signal_recipients_error_len
    CHECK (email_error IS NULL OR char_length(email_error) <= 500),
  CONSTRAINT signal_recipients_lease_owner_len
    CHECK (
      email_lease_owner IS NULL OR
      char_length(email_lease_owner) BETWEEN 1 AND 200
    ),
  CONSTRAINT signal_recipients_lease_state_chk
    CHECK (
      email_status <> 'SENDING' OR (
        email_lease_owner IS NOT NULL AND
        email_lease_expires_at IS NOT NULL
      )
    ),
  CONSTRAINT signal_recipients_sent_chk
    CHECK (email_status <> 'SENT' OR email_sent_at IS NOT NULL)
);

-- Inbox listing for one customer, newest first.
CREATE INDEX IF NOT EXISTS signal_recipients_user_created_idx
  ON signal_recipients (user_id, created_at DESC);

-- Unread badge and unread listing.
CREATE INDEX IF NOT EXISTS signal_recipients_unread_idx
  ON signal_recipients (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Delivery aggregation per signal.
CREATE INDEX IF NOT EXISTS signal_recipients_signal_idx
  ON signal_recipients (signal_id, email_status);

-- Due PENDING email rows.
CREATE INDEX IF NOT EXISTS signal_recipients_due_idx
  ON signal_recipients (email_next_attempt_at)
  WHERE email_status = 'PENDING';

-- SENDING rows whose lease has expired and may be reclaimed.
CREATE INDEX IF NOT EXISTS signal_recipients_lease_idx
  ON signal_recipients (email_lease_expires_at)
  WHERE email_status = 'SENDING';

-- ─── Append-only delivery diagnostics ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signal_email_attempts (
  attempt_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID        NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome       TEXT        NOT NULL,
  error_code    TEXT,
  error_message TEXT,
  CONSTRAINT signal_email_attempts_recipient_fk
    FOREIGN KEY (recipient_id)
    REFERENCES signal_recipients(recipient_id) ON DELETE CASCADE,
  CONSTRAINT signal_email_attempts_outcome_chk
    CHECK (outcome IN ('SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT signal_email_attempts_error_code_len
    CHECK (error_code IS NULL OR char_length(error_code) <= 80),
  CONSTRAINT signal_email_attempts_error_message_len
    CHECK (error_message IS NULL OR char_length(error_message) <= 500)
);

CREATE INDEX IF NOT EXISTS signal_email_attempts_recipient_idx
  ON signal_email_attempts (recipient_id, attempted_at DESC);
