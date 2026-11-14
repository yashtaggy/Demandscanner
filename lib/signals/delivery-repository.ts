/**
 * Signals email outbox persistence. SERVER ONLY.
 *
 * `signal_recipients` is the outbox: no additional queue table exists. Each
 * function is ONE statement because the Neon HTTP driver offers no interactive
 * transactions. Claiming uses `FOR UPDATE SKIP LOCKED`, so two dispatchers can
 * never claim the same live lease, and completion statements are guarded by
 * the lease owner so a slow or stale dispatcher cannot overwrite another's
 * work. No database lock is held while SMTP is in progress: the claim
 * statement commits before any message is sent.
 */

import { getDb } from "@/lib/db";
import { SIGNAL_EMAIL_MAX_ATTEMPTS } from "./dispatch-policy";

export const DISPATCH_BATCH_SIZE = 5;
/** Long enough to cover one bounded batch, short enough to recover quickly. */
export const DISPATCH_LEASE_SECONDS = 90;

export interface ClaimedRecipient {
  recipientId: string;
  signalId: string;
  userId: string;
  emailAddress: string;
  /** Attempt outcomes recorded before this claim. */
  priorAttempts: number;
  message: string;
}

export interface RecipientAccount {
  role: string;
  status: string;
}

export interface SanitizedAttemptError {
  code: string;
  message: string;
}

interface ClaimRow {
  recipient_id: string;
  signal_id: string;
  user_id: string;
  email_address: string;
  email_attempts: number | string;
  message: string;
}

interface TransitionRow {
  updated_count: number | string;
  final_status: string | null;
  final_attempts: number | string;
}

interface AccountRow {
  role: string;
  status: string;
}

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]+/g;

/** Bounds diagnostics to the schema limits and strips driver/server text. */
function sanitizeDiagnostic(value: string, maxLength: number): string {
  const cleaned = value
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength - 3)}...`
    : cleaned;
}

/**
 * Claims due PENDING rows and expired SENDING leases in one statement. A
 * recipient with a future `email_next_attempt_at` is not due and is left for a
 * later dispatch.
 *
 * The attempt ceiling gates expired SENDING leases only. Exhausted automatic
 * deliveries are FAILED, never PENDING, so a PENDING row above the ceiling can
 * only be an explicit admin requeue; it receives one more attempt and returns
 * to terminal FAILED if that attempt also fails.
 */
export async function claimDueRecipients(
  owner: string,
  limit: number = DISPATCH_BATCH_SIZE,
  leaseSeconds: number = DISPATCH_LEASE_SECONDS
): Promise<ClaimedRecipient[]> {
  const sql = getDb();

  const rows = (await sql`
    WITH candidate AS (
      SELECT r.recipient_id
        FROM signal_recipients r
       WHERE (
           (r.email_status = 'PENDING' AND r.email_next_attempt_at <= NOW())
           OR (
             r.email_status = 'SENDING'
             AND r.email_lease_expires_at IS NOT NULL
             AND r.email_lease_expires_at <= NOW()
             AND r.email_attempts < ${SIGNAL_EMAIL_MAX_ATTEMPTS}
           )
         )
       ORDER BY r.email_next_attempt_at ASC, r.created_at ASC, r.recipient_id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT ${limit}
    ),
    claimed AS (
      UPDATE signal_recipients r
         SET email_status = 'SENDING',
             email_lease_owner = ${owner},
             email_lease_expires_at = NOW() + make_interval(secs => ${leaseSeconds}),
             email_last_attempt_at = NOW()
       WHERE r.recipient_id IN (SELECT recipient_id FROM candidate)
      RETURNING r.recipient_id, r.signal_id, r.user_id, r.email_address,
                r.email_attempts
    )
    SELECT c.recipient_id, c.signal_id, c.user_id, c.email_address,
           c.email_attempts, s.message
      FROM claimed c
      JOIN signals s ON s.signal_id = c.signal_id
     ORDER BY c.recipient_id
  `) as ClaimRow[];

  return rows.map((row) => ({
    recipientId: row.recipient_id,
    signalId: row.signal_id,
    userId: row.user_id,
    emailAddress: row.email_address,
    priorAttempts: Number(row.email_attempts),
    message: row.message,
  }));
}

/** Current account state, re-read immediately before each SMTP attempt. */
export async function findRecipientAccount(
  userId: string
): Promise<RecipientAccount | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT role, status
      FROM app_users
     WHERE user_id = ${userId}::uuid
     LIMIT 1
  `) as AccountRow[];
  return rows.length > 0
    ? { role: rows[0].role, status: rows[0].status }
    : null;
}

/**
 * Records a SENT outcome only for the dispatcher that still owns the lease.
 * The update and its attempt row are one statement, so the outbox state and
 * the append-only history cannot disagree.
 */
export async function markRecipientSent(
  recipientId: string,
  owner: string
): Promise<boolean> {
  const sql = getDb();
  const rows = (await sql`
    WITH updated AS (
      UPDATE signal_recipients
         SET email_status = 'SENT',
             email_attempts = email_attempts + 1,
             email_last_attempt_at = NOW(),
             email_sent_at = NOW(),
             email_error = NULL,
             email_lease_owner = NULL,
             email_lease_expires_at = NULL
       WHERE recipient_id = ${recipientId}::uuid
         AND email_status = 'SENDING'
         AND email_lease_owner = ${owner}
      RETURNING recipient_id
    ),
    attempt AS (
      INSERT INTO signal_email_attempts (recipient_id, outcome)
      SELECT recipient_id, 'SENT' FROM updated
      RETURNING attempt_id
    )
    SELECT (SELECT count(*)::int FROM updated) AS updated_count,
           NULL::text AS final_status,
           0::int AS final_attempts
  `) as TransitionRow[];
  return Number(rows[0]?.updated_count ?? 0) > 0;
}

export interface FailedAttemptResult {
  applied: boolean;
  /** True once the fifth failed attempt leaves the row terminally FAILED. */
  terminal: boolean;
  attempts: number;
}

/**
 * Records a FAILED outcome. Attempts below the ceiling return to PENDING with
 * a deterministic backoff; the fifth failure stays FAILED with no automatic
 * retry. Manual admin retry can requeue an eligible FAILED row later.
 */
export async function markRecipientFailed(
  recipientId: string,
  owner: string,
  error: SanitizedAttemptError,
  retryDelaySeconds: number
): Promise<FailedAttemptResult> {
  const sql = getDb();
  const code = sanitizeDiagnostic(error.code, 80);
  const message = sanitizeDiagnostic(error.message, 500);

  const rows = (await sql`
    WITH updated AS (
      UPDATE signal_recipients
         SET email_status = CASE
               WHEN email_attempts + 1 >= ${SIGNAL_EMAIL_MAX_ATTEMPTS}
               THEN 'FAILED'
               ELSE 'PENDING'
             END,
             email_attempts = email_attempts + 1,
             email_last_attempt_at = NOW(),
             email_next_attempt_at = CASE
               WHEN email_attempts + 1 >= ${SIGNAL_EMAIL_MAX_ATTEMPTS}
               THEN NOW()
               ELSE NOW() + make_interval(secs => ${retryDelaySeconds})
             END,
             email_error = ${message},
             email_lease_owner = NULL,
             email_lease_expires_at = NULL
       WHERE recipient_id = ${recipientId}::uuid
         AND email_status = 'SENDING'
         AND email_lease_owner = ${owner}
      RETURNING recipient_id, email_status, email_attempts
    ),
    attempt AS (
      INSERT INTO signal_email_attempts (
        recipient_id, outcome, error_code, error_message
      )
      SELECT recipient_id, 'FAILED', ${code}, ${message} FROM updated
      RETURNING attempt_id
    )
    SELECT (SELECT count(*)::int FROM updated) AS updated_count,
           (SELECT email_status FROM updated LIMIT 1) AS final_status,
           COALESCE((SELECT email_attempts FROM updated LIMIT 1), 0) AS final_attempts
  `) as TransitionRow[];

  const row = rows[0];
  const applied = Number(row?.updated_count ?? 0) > 0;
  return {
    applied,
    terminal: applied && row.final_status === "FAILED",
    attempts: Number(row?.final_attempts ?? 0),
  };
}

/**
 * Records a SKIPPED outcome when the recipient is no longer an ACTIVE
 * CUSTOMER. The in-app signal row is never touched.
 */
export async function markRecipientSkipped(
  recipientId: string,
  owner: string,
  error: SanitizedAttemptError
): Promise<boolean> {
  const sql = getDb();
  const code = sanitizeDiagnostic(error.code, 80);
  const message = sanitizeDiagnostic(error.message, 500);

  const rows = (await sql`
    WITH updated AS (
      UPDATE signal_recipients
         SET email_status = 'SKIPPED',
             email_attempts = email_attempts + 1,
             email_last_attempt_at = NOW(),
             email_next_attempt_at = NOW(),
             email_error = ${message},
             email_lease_owner = NULL,
             email_lease_expires_at = NULL
       WHERE recipient_id = ${recipientId}::uuid
         AND email_status = 'SENDING'
         AND email_lease_owner = ${owner}
      RETURNING recipient_id
    ),
    attempt AS (
      INSERT INTO signal_email_attempts (
        recipient_id, outcome, error_code, error_message
      )
      SELECT recipient_id, 'SKIPPED', ${code}, ${message} FROM updated
      RETURNING attempt_id
    )
    SELECT (SELECT count(*)::int FROM updated) AS updated_count,
           NULL::text AS final_status,
           0::int AS final_attempts
  `) as TransitionRow[];
  return Number(rows[0]?.updated_count ?? 0) > 0;
}
