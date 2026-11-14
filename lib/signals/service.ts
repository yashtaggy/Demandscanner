/**
 * Signals administration rules. SERVER ONLY.
 *
 * Authorization happens in the route (requireSuperAdmin). This layer validates
 * the payload, resolves the server-side audience and turns repository outcomes
 * into stable public errors.
 */

import { randomUUID } from "node:crypto";
import type { AppUser } from "@/lib/auth/types";
import { SignalsError } from "./errors";
import {
  idempotencyFingerprintMatches,
  signalRequestFingerprint,
} from "./fingerprint";
import {
  findPublicationById,
  findPublicationByIdempotencyKey,
  findSignalDetail,
  listEligibleRecipients,
  listSignalHistory,
  publishSignal as insertPublication,
  retryFailedRecipients as updateRetries,
  type PublicationRecord,
} from "./repository";
import type {
  EligibleRecipientPage,
  RetryFailedResult,
  SignalDetail,
  SignalHistoryPage,
  SignalPublication,
} from "./types";
import {
  isValidUuid,
  parseAudience,
  parseHistoryQuery,
  parseIdempotencyKey,
  parseMessage,
  parseRecipientQuery,
} from "./validation";

function notFound(): never {
  throw new SignalsError(404, "SIGNAL_NOT_FOUND", "Signal not found.");
}

function toPublication(
  record: PublicationRecord,
  reused: boolean
): SignalPublication {
  return {
    signalId: record.signalId,
    message: record.message,
    publishedAt: record.publishedAt,
    createdBy: record.createdBy,
    status: record.status,
    recipientCount: record.recipientCount,
    reused,
  };
}

function requirePublicationRecord(
  record: PublicationRecord | null
): PublicationRecord {
  if (!record) {
    throw new SignalsError(
      500,
      "SIGNAL_FAILED",
      "The signal was published but could not be read back."
    );
  }
  return record;
}

function requirePublication(
  record: PublicationRecord | null,
  reused: boolean
): SignalPublication {
  return toPublication(requirePublicationRecord(record), reused);
}

/**
 * Returns the original publication only when the repeated request is the same
 * logical request. A key reused with a different message or audience is a
 * client error, not a replay: returning the old signal would hide that the new
 * message was never sent. Legacy rows have no fingerprint and fail closed.
 */
function replayPublication(
  record: PublicationRecord,
  expectedFingerprint: string | null
): SignalPublication {
  if (
    expectedFingerprint === null ||
    !idempotencyFingerprintMatches(record.idempotencyFingerprint, expectedFingerprint)
  ) {
    throw new SignalsError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This idempotency key was already used for a different request. Use a new key for a new signal."
    );
  }
  return toPublication(record, true);
}

export async function eligibleRecipients(
  params: URLSearchParams
): Promise<EligibleRecipientPage> {
  const query = parseRecipientQuery(params);
  return listEligibleRecipients(query.search, query.limit);
}

export async function publishSignal(
  actor: AppUser,
  body: Record<string, unknown>
): Promise<SignalPublication> {
  const message = parseMessage(body.message);
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  const audience = parseAudience(body.audience);
  const fingerprint = idempotencyKey
    ? signalRequestFingerprint(message, audience)
    : null;

  // A replay returns the original publication only when this request hashes to
  // the same fingerprint. The key identifies one logical request.
  if (idempotencyKey) {
    const existing = await findPublicationByIdempotencyKey(
      actor.userId,
      idempotencyKey
    );
    if (existing) return replayPublication(existing, fingerprint);
  }

  const outcome = await insertPublication({
    signalId: randomUUID(),
    actorUserId: actor.userId,
    message,
    audience,
    idempotencyKey,
    idempotencyFingerprint: fingerprint,
  });

  switch (outcome.kind) {
    case "created":
      return requirePublication(
        await findPublicationById(outcome.signalId),
        false
      );
    case "existing":
      return replayPublication(
        requirePublicationRecord(await findPublicationById(outcome.signalId)),
        fingerprint
      );
    case "recipient_mismatch":
      throw new SignalsError(
        409,
        "RECIPIENT_NOT_ELIGIBLE",
        "One or more selected recipients are not active customers. No signal was published."
      );
    case "no_recipients":
      throw new SignalsError(
        409,
        "NO_ELIGIBLE_RECIPIENTS",
        "There are no eligible recipients. No signal was published."
      );
    case "too_many_recipients":
      throw new SignalsError(
        409,
        "TOO_MANY_RECIPIENTS",
        "The eligible audience exceeds 1,000 recipients. No signal was published."
      );
    case "conflict": {
      // Another request with the same key committed while this one ran.
      const existing = idempotencyKey
        ? await findPublicationByIdempotencyKey(actor.userId, idempotencyKey)
        : null;
      if (existing) return replayPublication(existing, fingerprint);
      throw new SignalsError(
        503,
        "PUBLICATION_RETRY",
        "The signal could not be published. Try again."
      );
    }
  }
}

export async function signalHistory(
  params: URLSearchParams
): Promise<SignalHistoryPage> {
  const query = parseHistoryQuery(params);
  return listSignalHistory(query.page, query.pageSize);
}

export async function signalDetail(signalId: string): Promise<SignalDetail> {
  if (!isValidUuid(signalId)) notFound();
  const detail = await findSignalDetail(signalId);
  if (!detail) notFound();
  return detail;
}

export async function retryFailedRecipients(
  actor: AppUser,
  signalId: string
): Promise<RetryFailedResult> {
  if (!isValidUuid(signalId)) notFound();
  const result = await updateRetries(actor, signalId);
  if (!result.signalFound) notFound();
  return { signalId, retriedCount: result.retriedCount };
}
