-- 2026-11-13 Phase 3 — Live Trade ownership moves to internal DemandScan users.
--
-- Owner identity:
--   live_trade_groups.owner_user_id, live_trade_items.owner_user_id and
--   live_trade_quote_state.owner_user_id become UUID NOT NULL foreign keys to
--   app_users(user_id). The Kite user id is no longer an ownership key; it is
--   broker connectivity only and is stored by the Kite session tables.
--
-- Data safety:
--   Every owner value is converted with an explicit ::uuid cast. There is no
--   fallback, default owner, first-user assignment or text-to-owner mapping. A
--   legacy TEXT value that is not a UUID makes the conversion fail, leaving the
--   schema unchanged for that statement. Apply this migration only after
--   inspecting the target: db/migrate-phase3.js refuses to run when a TEXT
--   owner column still contains rows.
--
-- Preserved behaviour:
--   * Repeat trade entries for one instrument stay allowed. The legacy
--     (owner_user_id, instrument_id) unique index is NOT recreated.
--   * The composite (group_id, owner_user_id) foreign key still prevents an
--     item from referencing another owner's group. It is dropped only because
--     both column types change, then re-added.
--   * Group deletion still ungroups items first; the composite FK stays
--     NO ACTION.
--
-- Broker binding:
--   kite_session_bindings records which internal user established each Kite
--   session. Quote reads resolve the Kite token only through the bound session,
--   so one customer's Kite cookie can never be used as another customer's
--   ownership or broker connection.
--
-- The statement order matters: the composite FK and the text-only CHECK
-- constraints must be dropped before the owner columns change type, and the
-- foreign keys are added only after all three columns are UUID.

DROP INDEX IF EXISTS live_trade_items_owner_instrument_uq;

ALTER TABLE live_trade_items
  DROP CONSTRAINT IF EXISTS live_trade_items_group_owner_fk;

ALTER TABLE live_trade_quote_state
  DROP CONSTRAINT IF EXISTS live_trade_quote_state_owner_not_blank;

ALTER TABLE live_trade_items
  DROP CONSTRAINT IF EXISTS live_trade_items_owner_not_blank;

ALTER TABLE live_trade_groups
  DROP CONSTRAINT IF EXISTS live_trade_groups_owner_not_blank;

ALTER TABLE live_trade_groups
  DROP CONSTRAINT IF EXISTS live_trade_groups_owner_fk;

ALTER TABLE live_trade_items
  DROP CONSTRAINT IF EXISTS live_trade_items_owner_fk;

ALTER TABLE live_trade_quote_state
  DROP CONSTRAINT IF EXISTS live_trade_quote_state_owner_fk;

ALTER TABLE live_trade_groups
  ALTER COLUMN owner_user_id TYPE UUID USING owner_user_id::uuid;

ALTER TABLE live_trade_items
  ALTER COLUMN owner_user_id TYPE UUID USING owner_user_id::uuid;

ALTER TABLE live_trade_quote_state
  ALTER COLUMN owner_user_id TYPE UUID USING owner_user_id::uuid;

ALTER TABLE live_trade_groups
  ALTER COLUMN owner_user_id SET NOT NULL;

ALTER TABLE live_trade_items
  ALTER COLUMN owner_user_id SET NOT NULL;

ALTER TABLE live_trade_quote_state
  ALTER COLUMN owner_user_id SET NOT NULL;

ALTER TABLE live_trade_groups
  ADD CONSTRAINT live_trade_groups_owner_fk
  FOREIGN KEY (owner_user_id) REFERENCES app_users(user_id) ON DELETE CASCADE;

ALTER TABLE live_trade_items
  ADD CONSTRAINT live_trade_items_owner_fk
  FOREIGN KEY (owner_user_id) REFERENCES app_users(user_id) ON DELETE CASCADE;

ALTER TABLE live_trade_quote_state
  ADD CONSTRAINT live_trade_quote_state_owner_fk
  FOREIGN KEY (owner_user_id) REFERENCES app_users(user_id) ON DELETE CASCADE;

ALTER TABLE live_trade_items
  ADD CONSTRAINT live_trade_items_group_owner_fk
  FOREIGN KEY (group_id, owner_user_id)
  REFERENCES live_trade_groups (group_id, owner_user_id);

CREATE TABLE IF NOT EXISTS kite_session_bindings (
  session_id_hash  TEXT        PRIMARY KEY REFERENCES kite_sessions(session_id_hash) ON DELETE CASCADE,
  app_user_id      UUID        NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kite_session_bindings_user_idx
  ON kite_session_bindings (app_user_id);
