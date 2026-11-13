-- 2026-11-13 Phase 4 — subscription plans, assignments, payments, entitlement.
--
-- Additive and idempotent. Creates three new tables and one SQL predicate.
-- It does not alter or delete any existing table, column, row or index.
--
-- Date semantics:
--   start_date and end_date are inclusive Asia/Kolkata calendar dates. A
--   subscription ending 2026-12-31 grants access through 23:59:59 IST and
--   denies at 00:00 IST on 2027-01-01. is_subscription_entitled() is the
--   single predicate used for access checks, and it evaluates the supplied
--   instant (default NOW()) in Asia/Kolkata, never the server timezone.
--
-- Independence:
--   Account status remains app_users.status. A subscription never grants
--   access while the account is SUSPENDED or DISABLED, and reactivating an
--   account never changes subscription dates.
--
-- History:
--   Renewals insert new customer_subscriptions rows. Extensions change only
--   end_date and are recorded in admin_audit_log. Plans referenced by any
--   subscription cannot be deleted because the foreign key is RESTRICT.
--
-- Payments:
--   payment_records stores manually recorded payments only. No card, CVV,
--   banking credential or gateway token column exists.

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  description    TEXT,
  duration_days  INTEGER     NOT NULL,
  price          NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency       TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_plans_name_not_blank
    CHECK (btrim(name) <> ''),
  CONSTRAINT subscription_plans_name_len
    CHECK (char_length(btrim(name)) <= 120),
  CONSTRAINT subscription_plans_description_len
    CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT subscription_plans_duration_chk
    CHECK (duration_days BETWEEN 1 AND 3660),
  CONSTRAINT subscription_plans_price_chk
    CHECK (price >= 0),
  CONSTRAINT subscription_plans_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT subscription_plans_status_chk
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_name_lower_uq
  ON subscription_plans (lower(btrim(name)));

CREATE INDEX IF NOT EXISTS subscription_plans_status_created_idx
  ON subscription_plans (status, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  subscription_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL
    REFERENCES app_users(user_id) ON DELETE CASCADE,
  plan_id             UUID        NOT NULL
    REFERENCES subscription_plans(plan_id) ON DELETE RESTRICT,
  start_date          DATE        NOT NULL,
  end_date            DATE        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'PENDING',
  created_by          UUID        REFERENCES app_users(user_id) ON DELETE SET NULL,
  activated_at        TIMESTAMPTZ,
  activated_by        UUID        REFERENCES app_users(user_id) ON DELETE SET NULL,
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        UUID        REFERENCES app_users(user_id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  renewed_from_subscription_id UUID
    REFERENCES customer_subscriptions(subscription_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_subscriptions_dates_chk
    CHECK (end_date >= start_date),
  CONSTRAINT customer_subscriptions_id_user_uq
    UNIQUE (subscription_id, user_id),
  CONSTRAINT customer_subscriptions_status_chk
    CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT customer_subscriptions_cancellation_chk
    CHECK (
      status <> 'CANCELLED' OR (
        cancelled_at IS NOT NULL AND
        cancellation_reason IS NOT NULL AND
        btrim(cancellation_reason) <> ''
      )
    ),
  CONSTRAINT customer_subscriptions_cancel_reason_len
    CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 500)
);

CREATE INDEX IF NOT EXISTS customer_subscriptions_user_status_idx
  ON customer_subscriptions (user_id, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS customer_subscriptions_user_end_idx
  ON customer_subscriptions (user_id, end_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_subscriptions_plan_idx
  ON customer_subscriptions (plan_id);

CREATE INDEX IF NOT EXISTS customer_subscriptions_renewed_from_idx
  ON customer_subscriptions (renewed_from_subscription_id);

CREATE TABLE IF NOT EXISTS payment_records (
  payment_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL
    REFERENCES app_users(user_id) ON DELETE RESTRICT,
  subscription_id   UUID        NOT NULL,
  amount            NUMERIC(12,2) NOT NULL,
  currency          TEXT        NOT NULL,
  payment_method    TEXT        NOT NULL,
  payment_reference TEXT,
  payment_date      DATE        NOT NULL,
  payment_status    TEXT        NOT NULL DEFAULT 'RECORDED',
  notes             TEXT,
  recorded_by       UUID        REFERENCES app_users(user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_records_subscription_owner_fk
    FOREIGN KEY (subscription_id, user_id)
    REFERENCES customer_subscriptions(subscription_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT payment_records_amount_chk
    CHECK (amount > 0),
  CONSTRAINT payment_records_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_records_method_not_blank
    CHECK (btrim(payment_method) <> ''),
  CONSTRAINT payment_records_method_len
    CHECK (char_length(payment_method) <= 40),
  CONSTRAINT payment_records_reference_len
    CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 120),
  CONSTRAINT payment_records_status_chk
    CHECK (payment_status IN ('RECORDED', 'VOID')),
  CONSTRAINT payment_records_notes_len
    CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

CREATE INDEX IF NOT EXISTS payment_records_user_date_idx
  ON payment_records (user_id, payment_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_records_subscription_idx
  ON payment_records (subscription_id, created_at DESC);

CREATE OR REPLACE FUNCTION is_subscription_entitled(
  p_user_id UUID,
  p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM customer_subscriptions s
     WHERE s.user_id = p_user_id
       AND s.status = 'ACTIVE'
       AND (p_at AT TIME ZONE 'Asia/Kolkata')::date
           BETWEEN s.start_date AND s.end_date
       AND EXISTS (
         SELECT 1 FROM app_users u
          WHERE u.user_id = p_user_id
            AND u.status = 'ACTIVE'
       )
  )
$$;
