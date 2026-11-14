/**
 * Signals persistence. SERVER ONLY.
 *
 * Publication is a single data-modifying CTE statement, so the signal row, its
 * recipient snapshot and the audit event either all exist or none do. The Neon
 * HTTP driver has no interactive transactions; one statement is the strongest
 * atomic unit it offers.
 *
 * Recipient eligibility is resolved inside that statement from app_users
 * (`role = 'CUSTOMER' AND status = 'ACTIVE'`). Subscription state is never
 * consulted. A selected-id set is accepted only when every requested id
 * matches an eligible row; otherwise the guarded insert writes nothing and the
 * service reports a conflict.
 *
 * Idempotency is enforced by the partial unique index
 * `(created_by, idempotency_key)`. ON CONFLICT DO NOTHING plus the existing-key
 * guard means a replay can never create a second signal or recipient set. The
 * request fingerprint stored beside the key lets the service distinguish a
 * replay from a key reused for different content.
 */

import { getDb } from "@/lib/db";
import type { AppUser } from "@/lib/auth/types";
import type {
  CustomerReadState,
  CustomerSignalDetail,
  CustomerSignalInbox,
  CustomerSignalSummary,
  EligibleRecipient,
  EligibleRecipientPage,
  SignalDetail,
  SignalDeliverySummary,
  SignalEmailStatus,
  SignalHistoryEntry,
  SignalHistoryPage,
  SignalRecipientDetail,
  SignalStatus,
} from "./types";
import {
  SIGNAL_MAX_RECIPIENTS,
  escapeLike,
  type SignalAudience,
} from "./validation";

export interface PublishSignalParams {
  signalId: string;
  actorUserId: string;
  message: string;
  audience: SignalAudience;
  idempotencyKey: string | null;
  /** SHA-256 of the canonical request; NULL when no idempotency key is sent. */
  idempotencyFingerprint: string | null;
}

export type PublishSignalOutcome =
  | { kind: "created"; signalId: string }
  | { kind: "existing"; signalId: string }
  | { kind: "recipient_mismatch"; requestedCount: number; eligibleCount: number }
  | { kind: "no_recipients" }
  | { kind: "too_many_recipients"; eligibleCount: number }
  | { kind: "conflict" };

export interface PublicationRecord {
  signalId: string;
  message: string;
  publishedAt: string;
  createdBy: string | null;
  status: SignalStatus;
  recipientCount: number;
  /** NULL for publications created before the fingerprint column existed. */
  idempotencyFingerprint: string | null;
}

interface PublicationRow {
  signal_id: string;
  message: string;
  published_at: unknown;
  created_by: string | null;
  status: string;
  recipient_count: number | string;
  idempotency_fingerprint: string | null;
}

interface PublishResultRow {
  created_signal_id: string | null;
  existing_signal_id: string | null;
  requested_count: number | string;
  eligible_count: number | string;
  existing_count: number | string;
}

interface HistoryRow {
  signal_id: string;
  message_preview: string;
  published_at: unknown;
  status: string;
  recipient_count: number | string;
  pending_count: number | string;
  sending_count: number | string;
  sent_count: number | string;
  failed_count: number | string;
  skipped_count: number | string;
  read_count: number | string;
  unread_count: number | string;
  total: number | string;
}

interface DetailRow {
  signal_id: string;
  message: string;
  published_at: unknown;
  created_at: unknown;
  status: string;
  created_by: string | null;
  creator_email: string | null;
  creator_display_name: string | null;
  recipient_count: number | string;
  pending_count: number | string;
  sending_count: number | string;
  sent_count: number | string;
  failed_count: number | string;
  skipped_count: number | string;
  read_count: number | string;
  unread_count: number | string;
}

interface RecipientRow {
  recipient_id: string;
  user_id: string;
  email_address: string;
  display_name: string | null;
  read_at: unknown;
  email_status: string;
  email_attempts: number | string;
  email_last_attempt_at: unknown;
  email_sent_at: unknown;
  email_error: string | null;
}

interface RetryRow {
  signal_found: number | string;
  retried_count: number | string;
}

interface CustomerInboxRow {
  signal_id: string | null;
  message_preview: string | null;
  published_at: unknown;
  read_at: unknown;
  total: number | string;
  unread_count: number | string;
}

interface CustomerDetailRow {
  signal_id: string;
  message: string;
  published_at: unknown;
  read_at: unknown;
}

interface CustomerReadRow {
  signal_id: string;
  read_at: unknown;
}

interface UnreadCountRow {
  unread_count: number | string;
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

function deliverySummary(row: {
  pending_count: number | string;
  sending_count: number | string;
  sent_count: number | string;
  failed_count: number | string;
  skipped_count: number | string;
}): SignalDeliverySummary {
  return {
    pending: Number(row.pending_count),
    sending: Number(row.sending_count),
    sent: Number(row.sent_count),
    failed: Number(row.failed_count),
    skipped: Number(row.skipped_count),
  };
}

/** Removes control characters and bounds stored driver/SMTP text. */
function sanitizeErrorText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > 300 ? `${cleaned.slice(0, 297)}...` : cleaned;
}

function mapPublication(row: PublicationRow): PublicationRecord {
  return {
    signalId: row.signal_id,
    message: row.message,
    publishedAt: toIsoTimestamp(row.published_at),
    createdBy: row.created_by,
    status: row.status === "ARCHIVED" ? "ARCHIVED" : "PUBLISHED",
    recipientCount: Number(row.recipient_count),
    idempotencyFingerprint: row.idempotency_fingerprint,
  };
}

export async function listEligibleRecipients(
  search: string,
  limit: number
): Promise<EligibleRecipientPage> {
  const sql = getDb();
  const pattern = `%${escapeLike(search)}%`;

  const rows = (await sql`
    SELECT user_id, email, display_name
      FROM app_users
     WHERE role = 'CUSTOMER'
       AND status = 'ACTIVE'
       AND (
         ${search} = ''
         OR email ILIKE ${pattern} ESCAPE '\\'
         OR COALESCE(display_name, '') ILIKE ${pattern} ESCAPE '\\'
       )
     ORDER BY lower(COALESCE(NULLIF(btrim(display_name), ''), email)), email
     LIMIT ${limit + 1}
  `) as Array<{
    user_id: string;
    email: string;
    display_name: string | null;
  }>;

  const recipients: EligibleRecipient[] = rows.slice(0, limit).map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
  }));

  return { recipients, hasMore: rows.length > limit };
}

export async function findPublicationByIdempotencyKey(
  actorUserId: string,
  idempotencyKey: string
): Promise<PublicationRecord | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT s.signal_id, s.message, s.published_at, s.created_by, s.status,
           s.idempotency_fingerprint,
           (SELECT count(*)::int
              FROM signal_recipients r
             WHERE r.signal_id = s.signal_id) AS recipient_count
      FROM signals s
     WHERE s.created_by = ${actorUserId}::uuid
       AND s.idempotency_key = ${idempotencyKey}
     LIMIT 1
  `) as PublicationRow[];
  return rows.length > 0 ? mapPublication(rows[0]) : null;
}

export async function findPublicationById(
  signalId: string
): Promise<PublicationRecord | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT s.signal_id, s.message, s.published_at, s.created_by, s.status,
           s.idempotency_fingerprint,
           (SELECT count(*)::int
              FROM signal_recipients r
             WHERE r.signal_id = s.signal_id) AS recipient_count
      FROM signals s
     WHERE s.signal_id = ${signalId}::uuid
     LIMIT 1
  `) as PublicationRow[];
  return rows.length > 0 ? mapPublication(rows[0]) : null;
}

/**
 * Atomically publishes a signal or explains why nothing was written.
 *
 * All writes are conditioned on the same counts snapshot:
 *   * every requested id is an eligible customer (SELECTED mode),
 *   * the eligible audience is 1..1000,
 *   * no signal already exists for this (creator, key).
 */
export async function publishSignal(
  params: PublishSignalParams
): Promise<PublishSignalOutcome> {
  const sql = getDb();
  const userIds = params.audience.mode === "SELECTED" ? params.audience.userIds : [];
  const mode = params.audience.mode;

  const rows = (await sql`
    WITH existing AS (
      SELECT signal_id
        FROM signals
       WHERE ${params.idempotencyKey}::text IS NOT NULL
         AND created_by = ${params.actorUserId}::uuid
         AND idempotency_key = ${params.idempotencyKey}::text
    ),
    requested AS (
      SELECT DISTINCT unnest(${userIds}::uuid[]) AS user_id
    ),
    eligible AS (
      SELECT u.user_id, u.email
        FROM app_users u
       WHERE u.role = 'CUSTOMER'
         AND u.status = 'ACTIVE'
         AND (
           ${mode}::text = 'ALL_ELIGIBLE'
           OR u.user_id IN (SELECT user_id FROM requested)
         )
    ),
    counts AS (
      SELECT
        CASE
          WHEN ${mode}::text = 'ALL_ELIGIBLE'
          THEN (SELECT count(*)::int FROM eligible)
          ELSE (SELECT count(*)::int FROM requested)
        END AS requested_count,
        (SELECT count(*)::int FROM eligible) AS eligible_count,
        (SELECT count(*)::int FROM existing) AS existing_count
    ),
    new_signal AS (
      INSERT INTO signals (
        signal_id, message, created_by, idempotency_key, idempotency_fingerprint
      )
      SELECT
        ${params.signalId}::uuid,
        ${params.message}::text,
        ${params.actorUserId}::uuid,
        ${params.idempotencyKey}::text,
        ${params.idempotencyFingerprint}::text
       WHERE (SELECT existing_count FROM counts) = 0
         AND (SELECT eligible_count FROM counts) >= 1
         AND (SELECT eligible_count FROM counts) <= ${SIGNAL_MAX_RECIPIENTS}
         AND (SELECT eligible_count FROM counts) = (SELECT requested_count FROM counts)
      ON CONFLICT (created_by, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        DO NOTHING
      RETURNING signal_id
    ),
    inserted_recipients AS (
      INSERT INTO signal_recipients (signal_id, user_id, email_address)
      SELECT ns.signal_id, e.user_id, e.email
        FROM new_signal ns
        CROSS JOIN eligible e
      RETURNING recipient_id
    ),
    inserted_audit AS (
      INSERT INTO admin_audit_log (
        audit_id, actor_user_id, action, target_entity_type,
        target_entity_id, metadata
      )
      SELECT
        gen_random_uuid(),
        ${params.actorUserId}::uuid,
        'SIGNAL_PUBLISHED',
        'signal',
        ns.signal_id::text,
        jsonb_build_object(
          'audienceMode', ${mode}::text,
          'requestedCount', (SELECT requested_count FROM counts),
          'recipientCount', (SELECT count(*) FROM inserted_recipients),
          'idempotencyKeyPresent', (${params.idempotencyKey}::text IS NOT NULL)
        )
        FROM new_signal ns
      RETURNING audit_id
    )
    SELECT
      (SELECT signal_id FROM new_signal) AS created_signal_id,
      (SELECT signal_id FROM existing) AS existing_signal_id,
      (SELECT requested_count FROM counts) AS requested_count,
      (SELECT eligible_count FROM counts) AS eligible_count,
      (SELECT existing_count FROM counts) AS existing_count
  `) as PublishResultRow[];

  const row = rows[0];
  if (!row) return { kind: "conflict" };

  if (row.created_signal_id) {
    return { kind: "created", signalId: row.created_signal_id };
  }
  if (row.existing_signal_id) {
    return { kind: "existing", signalId: row.existing_signal_id };
  }

  const requestedCount = Number(row.requested_count);
  const eligibleCount = Number(row.eligible_count);

  if (mode === "SELECTED" && eligibleCount !== requestedCount) {
    return { kind: "recipient_mismatch", requestedCount, eligibleCount };
  }
  if (eligibleCount === 0) {
    return { kind: "no_recipients" };
  }
  if (eligibleCount > SIGNAL_MAX_RECIPIENTS) {
    return { kind: "too_many_recipients", eligibleCount };
  }
  return { kind: "conflict" };
}

export async function listSignalHistory(
  page: number,
  pageSize: number
): Promise<SignalHistoryPage> {
  const sql = getDb();
  const offset = (page - 1) * pageSize;

  const rows = (await sql`
    SELECT s.signal_id,
           left(regexp_replace(s.message, '\\s+', ' ', 'g'), 160) AS message_preview,
           s.published_at,
           s.status,
           count(r.recipient_id)::int AS recipient_count,
           count(*) FILTER (WHERE r.email_status = 'PENDING')::int AS pending_count,
           count(*) FILTER (WHERE r.email_status = 'SENDING')::int AS sending_count,
           count(*) FILTER (WHERE r.email_status = 'SENT')::int AS sent_count,
           count(*) FILTER (WHERE r.email_status = 'FAILED')::int AS failed_count,
           count(*) FILTER (WHERE r.email_status = 'SKIPPED')::int AS skipped_count,
           count(*) FILTER (WHERE r.read_at IS NOT NULL)::int AS read_count,
           count(*) FILTER (
             WHERE r.recipient_id IS NOT NULL AND r.read_at IS NULL
           )::int AS unread_count,
           (count(*) OVER())::int AS total
      FROM signals s
      LEFT JOIN signal_recipients r ON r.signal_id = s.signal_id
     GROUP BY s.signal_id, s.message, s.published_at, s.status
     ORDER BY s.published_at DESC, s.signal_id DESC
     LIMIT ${pageSize} OFFSET ${offset}
  `) as HistoryRow[];

  const signals: SignalHistoryEntry[] = rows.map((row) => ({
    signalId: row.signal_id,
    messagePreview: row.message_preview,
    publishedAt: toIsoTimestamp(row.published_at),
    status: row.status === "ARCHIVED" ? "ARCHIVED" : "PUBLISHED",
    recipientCount: Number(row.recipient_count),
    delivery: deliverySummary(row),
    read: {
      read: Number(row.read_count),
      unread: Number(row.unread_count),
    },
  }));

  return {
    signals,
    page,
    pageSize,
    total: rows.length > 0 ? Number(rows[0].total) : 0,
  };
}

export async function findSignalDetail(
  signalId: string
): Promise<SignalDetail | null> {
  const sql = getDb();

  const signals = (await sql`
    SELECT s.signal_id, s.message, s.published_at, s.created_at, s.status,
           s.created_by,
           a.email AS creator_email,
           a.display_name AS creator_display_name,
           count(r.recipient_id)::int AS recipient_count,
           count(*) FILTER (WHERE r.email_status = 'PENDING')::int AS pending_count,
           count(*) FILTER (WHERE r.email_status = 'SENDING')::int AS sending_count,
           count(*) FILTER (WHERE r.email_status = 'SENT')::int AS sent_count,
           count(*) FILTER (WHERE r.email_status = 'FAILED')::int AS failed_count,
           count(*) FILTER (WHERE r.email_status = 'SKIPPED')::int AS skipped_count,
           count(*) FILTER (WHERE r.read_at IS NOT NULL)::int AS read_count,
           count(*) FILTER (
             WHERE r.recipient_id IS NOT NULL AND r.read_at IS NULL
           )::int AS unread_count
      FROM signals s
      LEFT JOIN app_users a ON a.user_id = s.created_by
      LEFT JOIN signal_recipients r ON r.signal_id = s.signal_id
     WHERE s.signal_id = ${signalId}::uuid
     GROUP BY s.signal_id, a.email, a.display_name
  `) as DetailRow[];

  if (signals.length === 0) return null;
  const signal = signals[0];

  const recipients = (await sql`
    SELECT r.recipient_id, r.user_id, r.email_address, u.display_name,
           r.read_at, r.email_status, r.email_attempts,
           r.email_last_attempt_at, r.email_sent_at, r.email_error
      FROM signal_recipients r
      LEFT JOIN app_users u ON u.user_id = r.user_id
     WHERE r.signal_id = ${signalId}::uuid
     ORDER BY r.created_at ASC, r.recipient_id ASC
  `) as RecipientRow[];

  return {
    signalId: signal.signal_id,
    message: signal.message,
    publishedAt: toIsoTimestamp(signal.published_at),
    createdAt: toIsoTimestamp(signal.created_at),
    status: signal.status === "ARCHIVED" ? "ARCHIVED" : "PUBLISHED",
    createdBy:
      signal.created_by && signal.creator_email
        ? {
            userId: signal.created_by,
            email: signal.creator_email,
            displayName: signal.creator_display_name,
          }
        : null,
    recipientCount: Number(signal.recipient_count),
    delivery: deliverySummary(signal),
    read: {
      read: Number(signal.read_count),
      unread: Number(signal.unread_count),
    },
    recipients: recipients.map(
      (row): SignalRecipientDetail => ({
        recipientId: row.recipient_id,
        userId: row.user_id,
        email: row.email_address,
        displayName: row.display_name,
        readAt: toIsoTimestampOrNull(row.read_at),
        emailStatus: row.email_status as SignalEmailStatus,
        emailAttempts: Number(row.email_attempts),
        emailLastAttemptAt: toIsoTimestampOrNull(row.email_last_attempt_at),
        emailSentAt: toIsoTimestampOrNull(row.email_sent_at),
        emailError: sanitizeErrorText(row.email_error),
      })
    ),
  };
}

/**
 * Requeues FAILED recipients of one signal whose customer is still an ACTIVE
 * CUSTOMER. PENDING, SENDING, SENT and SKIPPED rows are untouched, including
 * rows currently leased by a dispatcher. The update and its audit event are
 * one statement.
 */
export async function retryFailedRecipients(
  actor: AppUser,
  signalId: string
): Promise<{ signalFound: boolean; retriedCount: number }> {
  const sql = getDb();

  const rows = (await sql`
    WITH target AS (
      SELECT signal_id FROM signals WHERE signal_id = ${signalId}::uuid
    ),
    retryable AS (
      SELECT r.recipient_id
        FROM signal_recipients r
        JOIN app_users u ON u.user_id = r.user_id
       WHERE r.signal_id = (SELECT signal_id FROM target)
         AND r.email_status = 'FAILED'
         AND u.role = 'CUSTOMER'
         AND u.status = 'ACTIVE'
    ),
    retried AS (
      UPDATE signal_recipients r
         SET email_status = 'PENDING',
             email_next_attempt_at = NOW(),
             email_error = NULL,
             email_lease_owner = NULL,
             email_lease_expires_at = NULL
       WHERE r.recipient_id IN (SELECT recipient_id FROM retryable)
         AND r.email_status = 'FAILED'
      RETURNING r.recipient_id
    ),
    audited AS (
      INSERT INTO admin_audit_log (
        audit_id, actor_user_id, action, target_entity_type,
        target_entity_id, metadata
      )
      SELECT
        gen_random_uuid(),
        ${actor.userId}::uuid,
        'SIGNAL_EMAIL_RETRY_REQUESTED',
        'signal',
        ${signalId}::text,
        jsonb_build_object(
          'eligibleFailedCount', (SELECT count(*) FROM retryable),
          'retriedCount', (SELECT count(*) FROM retried)
        )
        FROM target
      RETURNING audit_id
    )
    SELECT
      (SELECT count(*)::int FROM target) AS signal_found,
      (SELECT count(*)::int FROM retried) AS retried_count
  `) as RetryRow[];

  const row = rows[0];
  return {
    signalFound: Number(row?.signal_found ?? 0) > 0,
    retriedCount: Number(row?.retried_count ?? 0),
  };
}

// ─── Customer reads and read state ──────────────────────────────────────────
//
// Every statement below is scoped by the authenticated user id and requires a
// matching signal_recipients row, so another customer's signal can never be
// addressed even by guessing its id. Only PUBLISHED signals are visible.

/**
 * One page of the customer's own inbox, newest first, with the totals for the
 * whole (unpaginated) result. Stats are joined to the page as a single row so
 * an out-of-range page still reports the correct total and unread count.
 */
export async function listCustomerInbox(
  userId: string,
  page: number,
  pageSize: number
): Promise<CustomerSignalInbox> {
  const sql = getDb();
  const offset = (page - 1) * pageSize;

  const rows = (await sql`
    WITH mine AS (
      SELECT s.signal_id, s.message, s.published_at, r.read_at
        FROM signal_recipients r
        JOIN signals s ON s.signal_id = r.signal_id
       WHERE r.user_id = ${userId}::uuid
         AND s.status = 'PUBLISHED'
    ),
    page AS (
      SELECT signal_id,
             left(regexp_replace(message, '\\s+', ' ', 'g'), 160) AS message_preview,
             published_at, read_at
        FROM mine
       ORDER BY published_at DESC, signal_id DESC
       LIMIT ${pageSize} OFFSET ${offset}
    ),
    stats AS (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE read_at IS NULL)::int AS unread_count
        FROM mine
    )
    SELECT p.signal_id, p.message_preview, p.published_at, p.read_at,
           stats.total, stats.unread_count
      FROM stats
      LEFT JOIN page p ON TRUE
     ORDER BY p.published_at DESC, p.signal_id DESC
  `) as CustomerInboxRow[];

  const signals: CustomerSignalSummary[] = rows
    .filter((row) => row.signal_id !== null)
    .map((row) => ({
      signalId: row.signal_id as string,
      messagePreview: row.message_preview ?? "",
      publishedAt: toIsoTimestamp(row.published_at),
      readAt: toIsoTimestampOrNull(row.read_at),
      isRead: row.read_at !== null,
    }));

  return {
    signals,
    page,
    pageSize,
    total: rows.length > 0 ? Number(rows[0].total) : 0,
    unreadCount: rows.length > 0 ? Number(rows[0].unread_count) : 0,
  };
}

export async function findCustomerSignal(
  userId: string,
  signalId: string
): Promise<CustomerSignalDetail | null> {
  const sql = getDb();

  const rows = (await sql`
    SELECT s.signal_id, s.message, s.published_at, r.read_at
      FROM signal_recipients r
      JOIN signals s ON s.signal_id = r.signal_id
     WHERE r.user_id = ${userId}::uuid
       AND s.signal_id = ${signalId}::uuid
       AND s.status = 'PUBLISHED'
     LIMIT 1
  `) as CustomerDetailRow[];

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    signalId: row.signal_id,
    message: row.message,
    publishedAt: toIsoTimestamp(row.published_at),
    readAt: toIsoTimestampOrNull(row.read_at),
    isRead: row.read_at !== null,
  };
}

/**
 * Sets the caller's own read state. Ownership and PUBLISHED visibility are
 * part of the UPDATE predicate, so no row is returned for a signal that is not
 * assigned to this customer. Only read_at is written. Marking an already-read
 * signal read again keeps the original timestamp, which makes repeats
 * idempotent instead of silently moving the timestamp forward.
 */
export async function setCustomerReadState(
  userId: string,
  signalId: string,
  isRead: boolean
): Promise<CustomerReadState | null> {
  const sql = getDb();

  const rows = (await sql`
    UPDATE signal_recipients r
       SET read_at = CASE
             WHEN ${isRead}::boolean THEN COALESCE(r.read_at, NOW())
             ELSE NULL
           END
     WHERE r.user_id = ${userId}::uuid
       AND r.signal_id = ${signalId}::uuid
       AND EXISTS (
         SELECT 1 FROM signals s
          WHERE s.signal_id = r.signal_id
            AND s.status = 'PUBLISHED'
       )
    RETURNING r.signal_id, r.read_at
  `) as CustomerReadRow[];

  if (rows.length === 0) return null;
  return {
    signalId: rows[0].signal_id,
    readAt: toIsoTimestampOrNull(rows[0].read_at),
    isRead: rows[0].read_at !== null,
  };
}

export async function countCustomerUnread(userId: string): Promise<number> {
  const sql = getDb();

  const rows = (await sql`
    SELECT count(*)::int AS unread_count
      FROM signal_recipients r
      JOIN signals s ON s.signal_id = r.signal_id
     WHERE r.user_id = ${userId}::uuid
       AND r.read_at IS NULL
       AND s.status = 'PUBLISHED'
  `) as UnreadCountRow[];

  return Number(rows[0]?.unread_count ?? 0);
}
