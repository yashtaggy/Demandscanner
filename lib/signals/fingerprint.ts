/**
 * Stable request fingerprint for idempotent signal publication.
 *
 * An idempotency key identifies one logical request. The fingerprint lets a
 * replay prove that the request it is repeating is the same one that produced
 * the stored publication, so a reused key with different content is rejected
 * instead of silently returning the wrong signal.
 *
 * The canonical form is a JSON array, never a JSON object, so property order
 * cannot change the digest. Selected recipients are lower-cased, de-duplicated
 * and sorted with the locale-independent default ordering, so the same set in
 * any order hashes identically. ALL_ELIGIBLE hashes its mode only: that audience
 * means "everyone eligible at publication time", so a later membership change
 * must not turn a legitimate replay into a conflict.
 *
 * The version tag is part of the digest. If the canonical form ever changes,
 * bump the tag so old stored fingerprints mismatch rather than silently agree.
 */

import { createHash } from "node:crypto";
import type { SignalAudience } from "./validation";

export const SIGNAL_FINGERPRINT_VERSION = "demandscan.signal.idempotency.v1";

function canonicalUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map((userId) => userId.toLowerCase()))].sort();
}

export function signalRequestFingerprint(
  message: string,
  audience: SignalAudience
): string {
  const canonical = JSON.stringify([
    SIGNAL_FINGERPRINT_VERSION,
    audience.mode,
    message,
    audience.mode === "SELECTED" ? canonicalUserIds(audience.userIds) : null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Legacy publications have no stored fingerprint. They cannot be verified, so
 * they fail closed: a key that predates the column is never silently reused.
 */
export function idempotencyFingerprintMatches(
  stored: string | null,
  expected: string
): boolean {
  return stored !== null && stored === expected;
}
