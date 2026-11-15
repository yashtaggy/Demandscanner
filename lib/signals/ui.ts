/**
 * Client-safe Signals helpers. No React and no server imports, so both the
 * admin and customer UI share the same selection, idempotency and formatting
 * rules as the APIs.
 */

import type {
  CustomerSignalSummary,
  EligibleRecipient,
  SignalAudienceMode,
  SignalEmailStatus,
  SignalPublishDelivery,
  SignalPublishDeliveryCounts,
  SignalStatus,
} from "./types";
import { SIGNAL_MAX_RECIPIENTS, SIGNAL_MESSAGE_MAX_LENGTH } from "./validation";

/** Server maximum per recipient lookup; the picker grows up to this. */
export const RECIPIENT_PAGE_SIZE = 20;
export const RECIPIENT_PAGE_LIMIT = 100;

/** Broadcast after a read-state change so the header badge refreshes. */
export const UNREAD_REFRESH_EVENT = "signals:unread-changed";

export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export function publishValidation(
  message: string,
  mode: SignalAudienceMode,
  selectedCount: number
): string | null {
  if (message.trim().length === 0) {
    return "Write a message before publishing.";
  }
  if (countCodePoints(message) > SIGNAL_MESSAGE_MAX_LENGTH) {
    return "Message must be 10,000 characters or fewer.";
  }
  if (mode === "SELECTED" && selectedCount === 0) {
    return "Select at least one recipient.";
  }
  if (mode === "SELECTED" && selectedCount > SIGNAL_MAX_RECIPIENTS) {
    return "A signal can be sent to at most 1,000 recipients.";
  }
  return null;
}

export type Selection = ReadonlyMap<string, EligibleRecipient>;

export function selectionKey(userId: string): string {
  return userId.toLowerCase();
}

export function toggleRecipient(
  selection: Selection,
  recipient: EligibleRecipient,
  selected: boolean
): Map<string, EligibleRecipient> {
  const next = new Map(selection);
  const key = selectionKey(recipient.userId);
  if (selected) next.set(key, recipient);
  else next.delete(key);
  return next;
}

export function selectRecipients(
  selection: Selection,
  recipients: readonly EligibleRecipient[]
): Map<string, EligibleRecipient> {
  const next = new Map(selection);
  for (const recipient of recipients) {
    next.set(selectionKey(recipient.userId), recipient);
  }
  return next;
}

export function clearRecipients(
  selection: Selection,
  recipients: readonly EligibleRecipient[]
): Map<string, EligibleRecipient> {
  const next = new Map(selection);
  for (const recipient of recipients) {
    next.delete(selectionKey(recipient.userId));
  }
  return next;
}

export function allVisibleSelected(
  selection: Selection,
  visible: readonly EligibleRecipient[]
): boolean {
  return (
    visible.length > 0 &&
    visible.every((recipient) => selection.has(selectionKey(recipient.userId)))
  );
}

export function selectedRecipients(
  selection: Selection
): EligibleRecipient[] {
  return Array.from(selection.values());
}

/** Appends a new lookup page without duplicating recipients already listed. */
export function mergeRecipients(
  current: readonly EligibleRecipient[],
  incoming: readonly EligibleRecipient[]
): EligibleRecipient[] {
  const seen = new Set(current.map((recipient) => selectionKey(recipient.userId)));
  const merged = [...current];
  for (const recipient of incoming) {
    const key = selectionKey(recipient.userId);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(recipient);
  }
  return merged;
}

export function audienceFor(
  mode: SignalAudienceMode,
  selection: Selection
): { mode: "ALL_ELIGIBLE" } | { mode: "SELECTED"; userIds: string[] } {
  if (mode === "ALL_ELIGIBLE") return { mode: "ALL_ELIGIBLE" };
  return { mode: "SELECTED", userIds: Array.from(selection.keys()) };
}

export interface IdempotencyAttempt {
  key: string;
  fingerprint: string;
}

/**
 * Matches the server's notion of one logical request: the message and the
 * normalized recipient set. Editing either value starts a new attempt.
 */
export function requestFingerprint(
  message: string,
  mode: SignalAudienceMode,
  userIds: readonly string[]
): string {
  const ids =
    mode === "SELECTED"
      ? Array.from(new Set(userIds.map((userId) => userId.toLowerCase()))).sort()
      : null;
  return JSON.stringify([mode, message, ids]);
}

export function resolveIdempotencyAttempt(
  previous: IdempotencyAttempt | null,
  fingerprint: string,
  generate: () => string
): IdempotencyAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { key: generate(), fingerprint };
}

export function newIdempotencyKey(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === "function") {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${
    "89ab"[Number.parseInt(hex[16], 16) & 0x3]
  }${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function appendInboxPage(
  current: readonly CustomerSignalSummary[],
  incoming: readonly CustomerSignalSummary[]
): CustomerSignalSummary[] {
  const seen = new Set(current.map((signal) => signal.signalId));
  const merged = [...current];
  for (const signal of incoming) {
    if (seen.has(signal.signalId)) continue;
    seen.add(signal.signalId);
    merged.push(signal);
  }
  return merged;
}

export function unreadBadgeLabel(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  const whole = Math.floor(count);
  if (whole <= 0) return null;
  return whole > 99 ? "99+" : String(whole);
}

export function emailStatusVariant(
  status: SignalEmailStatus
): "neutral" | "info" | "success" | "danger" | "warning" {
  switch (status) {
    case "SENDING":
      return "info";
    case "SENT":
      return "success";
    case "FAILED":
      return "danger";
    case "SKIPPED":
      return "warning";
    default:
      return "neutral";
  }
}

export function signalStatusVariant(
  status: SignalStatus
): "success" | "neutral" {
  return status === "PUBLISHED" ? "success" : "neutral";
}

export function recipientSummaryLabel(count: number): string {
  return `${count} recipient${count === 1 ? "" : "s"}`;
}

function emailCountLabel(count: number): string {
  return `${count} email${count === 1 ? "" : "s"}`;
}

/**
 * Publish-result sentence. It only claims delivery that the summary proves:
 * `sent` counts records that actually reached SENT, never attempts. A failed
 * queue count is described as unconfirmed, never as a number, and no message
 * says that already-sent email will be retried.
 */
export function publishDeliveryLabel(delivery: SignalPublishDelivery): string {
  if (delivery.status === "EMAIL_NOT_CONFIGURED") {
    return "Signal published. Email configuration is incomplete. Recipients remain queued.";
  }
  if (delivery.status === "DISPATCH_FAILED") {
    // Delivery counts are unknown here; only rows still in the queue can be
    // retried, so the sentence must not promise anything about sent email.
    return "Signal published. Email delivery could not be confirmed. Any recipients still queued will be retried.";
  }
  if (delivery.status === "DISPATCHED_REPORTING_FAILED") {
    return reportingFailedLabel(delivery);
  }

  if (delivery.failed > 0) {
    return delivery.sent > 0
      ? `Signal published. ${emailCountLabel(delivery.sent)} sent; ${delivery.failed} failed. Check delivery status.`
      : "Signal published. Some email attempts failed. Check delivery status.";
  }
  if (delivery.attempted === 0) {
    return delivery.pending > 0
      ? "Signal published. No emails were attempted. Recipients remain queued."
      : "Signal published.";
  }
  if (delivery.sent === 0) {
    return "Signal published. No emails were sent; recipients are no longer active customers.";
  }
  if (delivery.pending > 0) {
    return `Signal published. ${emailCountLabel(delivery.sent)} sent; ${delivery.pending} remain queued.`;
  }
  return `Signal published. Emails sent to ${recipientSummaryLabel(delivery.sent)}.`;
}

/**
 * Delivery finished, so these counts are reliable, but the remaining queue is
 * unknown. The sentence reports sends and failures without guessing the queue
 * and without implying that delivered email will be sent again.
 */
function reportingFailedLabel(
  delivery: SignalPublishDeliveryCounts
): string {
  const queue = "The remaining queue count could not be confirmed.";
  if (delivery.failed > 0) {
    return delivery.sent > 0
      ? `Signal published. ${emailCountLabel(delivery.sent)} sent; ${delivery.failed} failed. ${queue}`
      : `Signal published. Some email attempts failed. ${queue}`;
  }
  if (delivery.attempted === 0) {
    return `Signal published. No emails were attempted. ${queue}`;
  }
  if (delivery.sent === 0) {
    return `Signal published. No emails were sent; recipients are no longer active customers. ${queue}`;
  }
  return `Signal published. ${emailCountLabel(delivery.sent)} sent. ${queue}`;
}
