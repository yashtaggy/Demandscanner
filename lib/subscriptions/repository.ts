/**
 * Subscription persistence. SERVER ONLY.
 *
 * Every mutation writes its admin_audit_log entry in the same statement as the
 * change. Subscription writes take a per-user advisory lock and reject
 * overlapping non-cancelled windows, so a retry or concurrent request cannot
 * create duplicate active periods. Access decisions are made by the database
 * function is_subscription_entitled(), never by a browser-supplied value.
 */

import { getDb } from "@/lib/db";
import {
  toIsoDate,
  daysRemainingInclusive,
  type TextResult,
} from "./validation";
import type {
  CustomerSubscriptionDetail,
  CustomerSubscriptionSummary,
  EffectiveSubscriptionStatus,
  PaymentRecord,
  StoredSubscriptionStatus,
  Subscription,
  SubscriptionPlan,
  SubscriptionPlanStatus,
  SubscriptionState,
} from "./types";

interface PlanRow {
  plan_id: string;
  name: string;
  description: string | null;
  duration_days: number;
  price: string | number;
  currency: string;
  status: string;
  created_at: unknown;
  updated_at: unknown;
}

interface SubscriptionRow {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  plan_name: string;
  plan_price: string | number;
  plan_currency: string;
  start_date: unknown;
  end_date: unknown;
  status: string;
  activated_at: unknown;
  cancelled_at: unknown;
  cancellation_reason: string | null;
  renewed_from_subscription_id: string | null;
  created_at: unknown;
}

interface PaymentRow {
  payment_id: string;
  user_id: string;
  subscription_id: string;
  amount: string | number;
  currency: string;
  payment_method: string;
  payment_reference: string | null;
  payment_date: unknown;
  payment_status: string;
  notes: string | null;
  recorded_by: string | null;
  created_at: unknown;
}

interface CustomerRow {
  user_id: string;
  email: string;
  display_name: string | null;
  status: string;
  role: string;
  created_at: unknown;
  subscription_id: string | null;
  subscription_user_id: string | null;
  subscription_plan_id: string | null;
  plan_name: string | null;
  plan_price: string | number | null;
  plan_currency: string | null;
  start_date: unknown;
  end_date: unknown;
  subscription_status: string | null;
  activated_at: unknown;
  cancelled_at: unknown;
  cancellation_reason: string | null;
  renewed_from_subscription_id: string | null;
  subscription_created_at: unknown;
  entitled: boolean;
  today_ist: unknown;
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function toIsoTimestampOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIsoTimestamp(value);
}

function mapPlan(row: PlanRow): SubscriptionPlan {
  return {
    planId: row.plan_id,
    name: row.name,
    description: row.description,
    durationDays: Number(row.duration_days),
    price: String(row.price),
    currency: row.currency,
    status: row.status as SubscriptionPlanStatus,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function effectiveStatus(
  status: StoredSubscriptionStatus,
  startDate: string,
  endDate: string,
  today: string
): EffectiveSubscriptionStatus {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "EXPIRED") return "EXPIRED";
  if (today < startDate) return "PENDING";
  if (today > endDate) return "EXPIRED";
  return status === "PENDING" ? "PENDING" : "ACTIVE";
}

function mapSubscription(row: SubscriptionRow, today: string): Subscription {
  const startDate = toIsoDate(row.start_date);
  const endDate = toIsoDate(row.end_date);
  const status = row.status as StoredSubscriptionStatus;
  const effective = effectiveStatus(status, startDate, endDate, today);
  return {
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    planId: row.plan_id,
    planName: row.plan_name,
    planPrice: String(row.plan_price),
    planCurrency: row.plan_currency,
    startDate,
    endDate,
    status,
    effectiveStatus: effective,
    daysRemaining:
      effective === "ACTIVE"
        ? daysRemainingInclusive(endDate, today)
        : null,
    activatedAt: toIsoTimestampOrNull(row.activated_at),
    cancelledAt: toIsoTimestampOrNull(row.cancelled_at),
    cancellationReason: row.cancellation_reason,
    renewedFromSubscriptionId: row.renewed_from_subscription_id,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    paymentId: row.payment_id,
    userId: row.user_id,
    subscriptionId: row.subscription_id,
    amount: String(row.amount),
    currency: row.currency,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    paymentDate: toIsoDate(row.payment_date),
    paymentStatus: row.payment_status as "RECORDED" | "VOID",
    notes: row.notes,
    recordedBy: row.recorded_by,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

function mapCustomer(
  row: CustomerRow,
  today: string
): CustomerSubscriptionSummary {
  const subscription = row.subscription_id
    ? mapSubscription(
        {
          subscription_id: row.subscription_id,
          user_id: row.subscription_user_id ?? row.user_id,
          plan_id: row.subscription_plan_id ?? "",
          plan_name: row.plan_name ?? "",
          plan_price: row.plan_price ?? "0",
          plan_currency: row.plan_currency ?? "",
          start_date: row.start_date,
          end_date: row.end_date,
          status: row.subscription_status ?? "PENDING",
          activated_at: row.activated_at,
          cancelled_at: row.cancelled_at,
          cancellation_reason: row.cancellation_reason,
          renewed_from_subscription_id: row.renewed_from_subscription_id,
          created_at: row.subscription_created_at,
        },
        today
      )
    : null;

  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    accountStatus: row.status as CustomerSubscriptionSummary["accountStatus"],
    role: row.role as CustomerSubscriptionSummary["role"],
    subscription,
    entitled: Boolean(row.entitled),
    createdAt: toIsoTimestamp(row.created_at),
  };
}

const PLAN_COLUMNS = `plan_id, name, description, duration_days, price,
  currency, status, created_at, updated_at`;

export async function listPlans(): Promise<SubscriptionPlan[]> {
  const sql = getDb();
  const rows = (await sql.query(
    `SELECT ${PLAN_COLUMNS} FROM subscription_plans
      ORDER BY status = 'ACTIVE' DESC, lower(name) ASC`,
    []
  )) as PlanRow[];
  return rows.map(mapPlan);
}

export async function findPlanById(
  planId: string
): Promise<SubscriptionPlan | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE plan_id = $1::uuid`,
    [planId]
  )) as PlanRow[];
  return rows.length ? mapPlan(rows[0]) : null;
}

export async function insertPlan(
  actorId: string,
  input: {
    name: string;
    description: string | null;
    durationDays: number;
    price: string;
    currency: string;
    status: SubscriptionPlanStatus;
  }
): Promise<SubscriptionPlan> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH inserted AS (
       INSERT INTO subscription_plans
         (name, description, duration_days, price, currency, status)
       VALUES ($1, $2, $3, $4::numeric, $5, $6)
       RETURNING ${PLAN_COLUMNS}
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $7::uuid, 'PLAN_CREATED', 'subscription_plan',
              i.plan_id::text,
              jsonb_build_object(
                'name', i.name,
                'durationDays', i.duration_days,
                'price', i.price,
                'currency', i.currency,
                'status', i.status
              )
         FROM inserted i
     )
     SELECT ${PLAN_COLUMNS} FROM inserted`,
    [
      input.name,
      input.description,
      input.durationDays,
      input.price,
      input.currency,
      input.status,
      actorId,
    ]
  )) as PlanRow[];
  return mapPlan(rows[0]);
}

export async function updatePlanRow(
  actorId: string,
  planId: string,
  input: {
    name: string;
    description: string | null;
    durationDays: number;
    price: string;
    currency: string;
    status: SubscriptionPlanStatus;
  }
): Promise<SubscriptionPlan | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE subscription_plans
          SET name = $1,
              description = $2,
              duration_days = $3,
              price = $4::numeric,
              currency = $5,
              status = $6,
              updated_at = NOW()
        WHERE plan_id = $7::uuid
        RETURNING ${PLAN_COLUMNS}
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $8::uuid, 'PLAN_UPDATED', 'subscription_plan',
              u.plan_id::text,
              jsonb_build_object(
                'name', u.name,
                'durationDays', u.duration_days,
                'price', u.price,
                'currency', u.currency,
                'status', u.status
              )
         FROM updated u
     )
     SELECT ${PLAN_COLUMNS} FROM updated`,
    [
      input.name,
      input.description,
      input.durationDays,
      input.price,
      input.currency,
      input.status,
      planId,
      actorId,
    ]
  )) as PlanRow[];
  return rows.length ? mapPlan(rows[0]) : null;
}

export async function listSubscriptionsForUser(
  userId: string
): Promise<Subscription[]> {
  const sql = getDb();
  const rows = (await sql.query(
    `SELECT s.subscription_id, s.user_id, s.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            s.start_date, s.end_date, s.status,
            s.activated_at, s.cancelled_at, s.cancellation_reason,
            s.renewed_from_subscription_id, s.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM customer_subscriptions s
       JOIN subscription_plans p ON p.plan_id = s.plan_id
      WHERE s.user_id = $1::uuid
      ORDER BY s.start_date DESC, s.created_at DESC`,
    [userId]
  )) as Array<SubscriptionRow & { today_ist: unknown }>;
  return rows.map((row) => mapSubscription(row, toIsoDate(row.today_ist)));
}

export async function findSubscriptionById(
  subscriptionId: string
): Promise<Subscription | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `SELECT s.subscription_id, s.user_id, s.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            s.start_date, s.end_date, s.status,
            s.activated_at, s.cancelled_at, s.cancellation_reason,
            s.renewed_from_subscription_id, s.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM customer_subscriptions s
       JOIN subscription_plans p ON p.plan_id = s.plan_id
      WHERE s.subscription_id = $1::uuid`,
    [subscriptionId]
  )) as Array<SubscriptionRow & { today_ist: unknown }>;
  return rows.length
    ? mapSubscription(rows[0], toIsoDate(rows[0].today_ist))
    : null;
}

/**
 * Current state for one user. The `entitled` flag is produced by the database
 * predicate; `today` is PostgreSQL's IST date, so ordering and display cannot
 * drift with the server timezone.
 */
export async function getSubscriptionState(
  userId: string
): Promise<SubscriptionState> {
  const sql = getDb();
  const rows = (await sql.query(
    `SELECT s.subscription_id, s.user_id, s.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            s.start_date, s.end_date, s.status,
            s.activated_at, s.cancelled_at, s.cancellation_reason,
            s.renewed_from_subscription_id, s.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist,
            is_subscription_entitled($1::uuid) AS entitled
       FROM customer_subscriptions s
       JOIN subscription_plans p ON p.plan_id = s.plan_id
      WHERE s.user_id = $1::uuid
      ORDER BY
        (s.status = 'ACTIVE'
         AND (NOW() AT TIME ZONE 'Asia/Kolkata')::date
             BETWEEN s.start_date AND s.end_date) DESC,
        s.end_date DESC,
        s.created_at DESC`,
    [userId]
  )) as Array<SubscriptionRow & { today_ist: unknown; entitled: boolean }>;

  const today = rows.length
    ? toIsoDate(rows[0].today_ist)
    : toIsoDate(
        (
          (await sql.query(
            `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist`,
            []
          )) as Array<{ today_ist: unknown }>
        )[0]?.today_ist
      );

  const history = rows.map((row) => mapSubscription(row, today));
  const entitled = rows.length > 0 && Boolean(rows[0].entitled);
  const current =
    history.find(
      (subscription) =>
        subscription.status === "ACTIVE" &&
        subscription.startDate <= today &&
        subscription.endDate >= today
    ) ??
    history[0] ??
    null;

  return { entitled, today, current, history };
}

export async function insertSubscription(
  actorId: string,
  input: {
    userId: string;
    planId: string;
    startDate: string;
    status: "PENDING";
  }
): Promise<Subscription | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH locked AS (
       SELECT pg_advisory_xact_lock(hashtext(($1::uuid)::text)) AS lock
     ), candidate AS (
       SELECT $2::date AS start_date,
              ($2::date + p.duration_days - 1) AS end_date,
              p.plan_id
         FROM subscription_plans p, locked
        WHERE p.plan_id = $3::uuid
     ), blocked AS (
       SELECT 1
         FROM customer_subscriptions s, candidate c, locked
        WHERE s.user_id = $1::uuid
          AND s.status <> 'CANCELLED'
          AND daterange(s.start_date, s.end_date, '[]')
              && daterange(c.start_date, c.end_date, '[]')
     ), inserted AS (
       INSERT INTO customer_subscriptions
         (user_id, plan_id, start_date, end_date, status, created_by)
       SELECT $1::uuid, c.plan_id, c.start_date, c.end_date, 'PENDING', $4::uuid
         FROM candidate c
        WHERE NOT EXISTS (SELECT 1 FROM blocked)
       RETURNING subscription_id, user_id, plan_id, start_date, end_date,
                 status, activated_at, cancelled_at, cancellation_reason,
                 renewed_from_subscription_id, created_at
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $4::uuid, 'SUBSCRIPTION_ASSIGNED',
              'customer_subscription', i.subscription_id::text,
              jsonb_build_object(
                'userId', i.user_id,
                'planId', i.plan_id,
                'startDate', i.start_date,
                'endDate', i.end_date
              )
         FROM inserted i
     )
     SELECT i.subscription_id, i.user_id, i.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            i.start_date, i.end_date, i.status,
            i.activated_at, i.cancelled_at, i.cancellation_reason,
            i.renewed_from_subscription_id, i.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM inserted i
       JOIN subscription_plans p ON p.plan_id = i.plan_id`,
    [input.userId, input.startDate, input.planId, actorId]
  )) as Array<SubscriptionRow & { today_ist: unknown }>;
  return rows.length
    ? mapSubscription(rows[0], toIsoDate(rows[0].today_ist))
    : null;
}

export async function activateSubscriptionRow(
  actorId: string,
  userId: string,
  subscriptionId: string
): Promise<Subscription | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH locked AS (
       SELECT pg_advisory_xact_lock(hashtext(($1::uuid)::text)) AS lock
     ), target AS (
       SELECT s.*
         FROM customer_subscriptions s
        WHERE s.subscription_id = $2::uuid
          AND s.user_id = $1::uuid
          AND s.status = 'PENDING'
     ), blocked AS (
       SELECT 1
         FROM customer_subscriptions s, target t, locked
        WHERE s.user_id = t.user_id
          AND s.subscription_id <> t.subscription_id
          AND s.status <> 'CANCELLED'
          AND daterange(s.start_date, s.end_date, '[]')
              && daterange(t.start_date, t.end_date, '[]')
     ), updated AS (
       UPDATE customer_subscriptions s
          SET status = 'ACTIVE',
              activated_at = NOW(),
              activated_by = $3::uuid,
              updated_at = NOW()
        WHERE s.subscription_id IN (SELECT subscription_id FROM target)
          AND s.end_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          AND NOT EXISTS (SELECT 1 FROM blocked)
        RETURNING s.subscription_id, s.user_id, s.plan_id, s.start_date,
                  s.end_date, s.status, s.activated_at, s.cancelled_at,
                  s.cancellation_reason, s.renewed_from_subscription_id,
                  s.created_at
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $3::uuid, 'SUBSCRIPTION_ACTIVATED',
              'customer_subscription', u.subscription_id::text,
              jsonb_build_object(
                'userId', u.user_id,
                'planId', u.plan_id,
                'startDate', u.start_date,
                'endDate', u.end_date
              )
         FROM updated u
     )
     SELECT u.subscription_id, u.user_id, u.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            u.start_date, u.end_date, u.status,
            u.activated_at, u.cancelled_at, u.cancellation_reason,
            u.renewed_from_subscription_id, u.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM updated u
       JOIN subscription_plans p ON p.plan_id = u.plan_id`,
    [userId, subscriptionId, actorId]
  )) as Array<SubscriptionRow & { today_ist: unknown }>;
  return rows.length
    ? mapSubscription(rows[0], toIsoDate(rows[0].today_ist))
    : null;
}

export async function extendSubscriptionRow(
  actorId: string,
  userId: string,
  subscriptionId: string,
  additionalDays: number
): Promise<Subscription | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH locked AS (
       SELECT pg_advisory_xact_lock(hashtext(($1::uuid)::text)) AS lock
     ), target AS (
       SELECT s.*
         FROM customer_subscriptions s
        WHERE s.subscription_id = $2::uuid
          AND s.user_id = $1::uuid
          AND s.status IN ('PENDING', 'ACTIVE')
     ), proposed AS (
       SELECT t.*, (t.end_date + $3::int) AS new_end
         FROM target t, locked
     ), blocked AS (
       SELECT 1
         FROM customer_subscriptions s, proposed p
        WHERE s.user_id = p.user_id
          AND s.subscription_id <> p.subscription_id
          AND s.status <> 'CANCELLED'
          AND daterange(s.start_date, s.end_date, '[]')
              && daterange(p.start_date, p.new_end, '[]')
     ), updated AS (
       UPDATE customer_subscriptions s
          SET end_date = p.new_end,
              updated_at = NOW()
         FROM proposed p
        WHERE s.subscription_id = p.subscription_id
          AND NOT EXISTS (SELECT 1 FROM blocked)
        RETURNING s.subscription_id, s.user_id, s.plan_id, s.start_date,
                  s.end_date, s.status, s.activated_at, s.cancelled_at,
                  s.cancellation_reason, s.renewed_from_subscription_id,
                  s.created_at
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $4::uuid, 'SUBSCRIPTION_EXTENDED',
              'customer_subscription', u.subscription_id::text,
              jsonb_build_object(
                'userId', u.user_id,
                'planId', u.plan_id,
                'additionalDays', $3::int,
                'startDate', u.start_date,
                'endDate', u.end_date
              )
         FROM updated u
     )
     SELECT u.subscription_id, u.user_id, u.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            u.start_date, u.end_date, u.status,
            u.activated_at, u.cancelled_at, u.cancellation_reason,
            u.renewed_from_subscription_id, u.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM updated u
       JOIN subscription_plans p ON p.plan_id = u.plan_id`,
    [userId, subscriptionId, additionalDays, actorId]
  )) as Array<SubscriptionRow & { today_ist: unknown }>;
  return rows.length
    ? mapSubscription(rows[0], toIsoDate(rows[0].today_ist))
    : null;
}

export async function cancelSubscriptionRow(
  actorId: string,
  userId: string,
  subscriptionId: string,
  reason: string
): Promise<Subscription | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE customer_subscriptions s
          SET status = 'CANCELLED',
              cancelled_at = NOW(),
              cancelled_by = $3::uuid,
              cancellation_reason = $4,
              updated_at = NOW()
        WHERE s.subscription_id = $1::uuid
          AND s.user_id = $2::uuid
          AND s.status <> 'CANCELLED'
        RETURNING s.subscription_id, s.user_id, s.plan_id, s.start_date,
                  s.end_date, s.status, s.activated_at, s.cancelled_at,
                  s.cancellation_reason, s.renewed_from_subscription_id,
                  s.created_at
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $3::uuid, 'SUBSCRIPTION_CANCELLED',
              'customer_subscription', u.subscription_id::text,
              jsonb_build_object(
                'userId', u.user_id,
                'planId', u.plan_id,
                'reason', u.cancellation_reason
              )
         FROM updated u
     )
     SELECT u.subscription_id, u.user_id, u.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            u.start_date, u.end_date, u.status,
            u.activated_at, u.cancelled_at, u.cancellation_reason,
            u.renewed_from_subscription_id, u.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM updated u
       JOIN subscription_plans p ON p.plan_id = u.plan_id`,
    [subscriptionId, userId, actorId, reason]
  )) as Array<SubscriptionRow & { today_ist: unknown }>;
  return rows.length
    ? mapSubscription(rows[0], toIsoDate(rows[0].today_ist))
    : null;
}

export async function insertRenewal(
  actorId: string,
  input: {
    userId: string;
    baseSubscriptionId: string;
    planId: string;
    startDate: string | null;
  }
): Promise<Subscription | null> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH locked AS (
       SELECT pg_advisory_xact_lock(hashtext(($1::uuid)::text)) AS lock
     ), base AS (
       SELECT s.*
         FROM customer_subscriptions s
        WHERE s.subscription_id = $2::uuid
          AND s.user_id = $1::uuid
          AND s.status <> 'CANCELLED'
     ), candidate AS (
       SELECT COALESCE($3::date, b.end_date + 1) AS start_date,
              COALESCE($3::date, b.end_date + 1)
                + p.duration_days - 1 AS end_date,
              p.plan_id
         FROM subscription_plans p, base b, locked
        WHERE p.plan_id = $4::uuid
     ), blocked AS (
       SELECT 1
         FROM customer_subscriptions s, candidate c
        WHERE s.user_id = $1::uuid
          AND s.subscription_id <> $2::uuid
          AND s.status <> 'CANCELLED'
          AND daterange(s.start_date, s.end_date, '[]')
              && daterange(c.start_date, c.end_date, '[]')
     ), inserted AS (
       INSERT INTO customer_subscriptions
         (user_id, plan_id, start_date, end_date, status, created_by,
          renewed_from_subscription_id)
       SELECT $1::uuid, c.plan_id, c.start_date, c.end_date, 'ACTIVE', $5::uuid,
              $2::uuid
         FROM candidate c
        WHERE NOT EXISTS (SELECT 1 FROM blocked)
       RETURNING subscription_id, user_id, plan_id, start_date, end_date,
                 status, activated_at, cancelled_at, cancellation_reason,
                 renewed_from_subscription_id, created_at
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $5::uuid, 'SUBSCRIPTION_RENEWED',
              'customer_subscription', i.subscription_id::text,
              jsonb_build_object(
                'userId', i.user_id,
                'planId', i.plan_id,
                'startDate', i.start_date,
                'endDate', i.end_date,
                'renewedFrom', i.renewed_from_subscription_id
              )
         FROM inserted i
     )
     SELECT i.subscription_id, i.user_id, i.plan_id,
            p.name AS plan_name, p.price AS plan_price,
            p.currency AS plan_currency,
            i.start_date, i.end_date, i.status,
            i.activated_at, i.cancelled_at, i.cancellation_reason,
            i.renewed_from_subscription_id, i.created_at,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM inserted i
       JOIN subscription_plans p ON p.plan_id = i.plan_id`,
    [
      input.userId,
      input.baseSubscriptionId,
      input.startDate,
      input.planId,
      actorId,
    ]
  )) as Array<SubscriptionRow & { today_ist: unknown }>;
  return rows.length
    ? mapSubscription(rows[0], toIsoDate(rows[0].today_ist))
    : null;
}

export async function insertPayment(
  actorId: string,
  input: {
    userId: string;
    subscriptionId: string;
    amount: string;
    currency: string;
    paymentMethod: string;
    paymentReference: string | null;
    paymentDate: string;
    notes: string | null;
  }
): Promise<PaymentRecord> {
  const sql = getDb();
  const rows = (await sql.query(
    `WITH inserted AS (
       INSERT INTO payment_records
         (user_id, subscription_id, amount, currency, payment_method,
          payment_reference, payment_date, payment_status, notes, recorded_by)
       VALUES ($1::uuid, $2::uuid, $3::numeric, $4, $5, $6, $7::date,
               'RECORDED', $8, $9::uuid)
       RETURNING payment_id, user_id, subscription_id, amount, currency,
                 payment_method, payment_reference, payment_date,
                 payment_status, notes, recorded_by, created_at
     ), audit AS (
       INSERT INTO admin_audit_log
         (audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata)
       SELECT gen_random_uuid(), $9::uuid, 'PAYMENT_RECORDED',
              'payment_record', i.payment_id::text,
              jsonb_build_object(
                'userId', i.user_id,
                'subscriptionId', i.subscription_id,
                'amount', i.amount,
                'currency', i.currency,
                'paymentDate', i.payment_date
              )
         FROM inserted i
     )
     SELECT * FROM inserted`,
    [
      input.userId,
      input.subscriptionId,
      input.amount,
      input.currency,
      input.paymentMethod,
      input.paymentReference,
      input.paymentDate,
      input.notes,
      actorId,
    ]
  )) as PaymentRow[];
  return mapPayment(rows[0]);
}

export async function listPaymentsForUser(
  userId: string
): Promise<PaymentRecord[]> {
  const sql = getDb();
  const rows = (await sql.query(
    `SELECT payment_id, user_id, subscription_id, amount, currency,
            payment_method, payment_reference, payment_date, payment_status,
            notes, recorded_by, created_at
       FROM payment_records
      WHERE user_id = $1::uuid
      ORDER BY payment_date DESC, created_at DESC`,
    [userId]
  )) as PaymentRow[];
  return rows.map(mapPayment);
}

export async function listCustomerSummaries(
  search: string
): Promise<CustomerSubscriptionSummary[]> {
  const sql = getDb();
  const normalized = search.trim();
  const pattern = `%${normalized.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  const rows = (await sql.query(
    `WITH latest AS (
       SELECT DISTINCT ON (s.user_id)
              s.user_id, s.subscription_id, s.plan_id, s.start_date,
              s.end_date, s.status, s.activated_at, s.cancelled_at,
              s.cancellation_reason, s.renewed_from_subscription_id,
              s.created_at,
              p.name AS plan_name, p.price AS plan_price,
              p.currency AS plan_currency
         FROM customer_subscriptions s
         JOIN subscription_plans p ON p.plan_id = s.plan_id
        ORDER BY
          s.user_id,
          (s.status = 'ACTIVE'
           AND (NOW() AT TIME ZONE 'Asia/Kolkata')::date
               BETWEEN s.start_date AND s.end_date) DESC,
          s.end_date DESC,
          s.created_at DESC
     )
     SELECT u.user_id, u.email, u.display_name, u.status, u.role, u.created_at,
            l.subscription_id, l.user_id AS subscription_user_id,
            l.plan_id AS subscription_plan_id,
            l.plan_name, l.plan_price, l.plan_currency,
            l.start_date, l.end_date, l.status AS subscription_status,
            l.activated_at, l.cancelled_at, l.cancellation_reason,
            l.renewed_from_subscription_id,
            l.created_at AS subscription_created_at,
            is_subscription_entitled(u.user_id) AS entitled,
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
       FROM app_users u
       LEFT JOIN latest l ON l.user_id = u.user_id
      WHERE u.role = 'CUSTOMER'
        AND ($1 = ''
             OR u.email ILIKE $2 ESCAPE '\\'
             OR COALESCE(u.display_name, '') ILIKE $2 ESCAPE '\\')
      ORDER BY u.created_at DESC
      LIMIT 100`,
    [normalized, pattern]
  )) as CustomerRow[];
  return rows.map((row) => mapCustomer(row, toIsoDate(row.today_ist)));
}

export async function getCustomerDetail(
  userId: string
): Promise<CustomerSubscriptionDetail | null> {
  const sql = getDb();
  const users = (await sql.query(
    `SELECT user_id, email, display_name, status, role, created_at
       FROM app_users
      WHERE user_id = $1::uuid`,
    [userId]
  )) as Array<{
    user_id: string;
    email: string;
    display_name: string | null;
    status: string;
    role: string;
    created_at: unknown;
  }>;
  if (users.length === 0) return null;

  const user = users[0];
  const subscriptions = await listSubscriptionsForUser(userId);
  const payments = await listPaymentsForUser(userId);

  return {
    customer: {
      userId: user.user_id,
      email: user.email,
      displayName: user.display_name,
      accountStatus: user.status as CustomerSubscriptionDetail["customer"]["accountStatus"],
      role: user.role as CustomerSubscriptionDetail["customer"]["role"],
      createdAt: toIsoTimestamp(user.created_at),
    },
    subscriptions,
    payments,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "23505"
  );
}

export type { TextResult };
