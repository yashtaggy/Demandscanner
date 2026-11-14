-- 2026-11-15 Signals — idempotency request fingerprint.
--
-- Additive and idempotent. Adds one nullable column to signals and a shape
-- CHECK. It does not alter, rename, drop, truncate or delete any existing
-- table, column, row, index or constraint. The unique index
-- signals_created_by_idempotency_uq is left exactly as created.
--
-- Why:
--   An idempotency key identifies one logical request. Without a stored
--   fingerprint a replay cannot distinguish "the same request" from "the same
--   key with a different message or audience". The API now stores a SHA-256 of
--   the canonical request and answers a mismatched reuse with
--   409 IDEMPOTENCY_KEY_REUSED instead of returning the old signal.
--
-- Legacy rows:
--   Publications created before this column existed keep NULL. Their replay
--   cannot be verified, so the API fails closed with the same 409 rather than
--   returning a signal that may not match the request.
--
-- The column is nullable on purpose: existing rows must remain valid, and the
-- partial unique index already enforces at most one publication per key.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT
  CONSTRAINT signals_idempotency_fingerprint_chk
  CHECK (
    idempotency_fingerprint IS NULL OR
    idempotency_fingerprint ~ '^[0-9a-f]{64}$'
  );
