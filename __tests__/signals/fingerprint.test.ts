/**
 * Idempotency fingerprint contract.
 *
 * The fingerprint is the only thing that lets a replay distinguish "same
 * request" from "same key, different content". These tests pin the canonical
 * form: array-based (property order cannot matter), order-independent for
 * selected recipients, mode-only for ALL_ELIGIBLE, and exact for the message.
 */

import { createHash } from "crypto";
import {
  SIGNAL_FINGERPRINT_VERSION,
  idempotencyFingerprintMatches,
  signalRequestFingerprint,
} from "@/lib/signals/fingerprint";

const ID_A = "bbbbbbbb-2222-4222-8222-222222222222";
const ID_B = "cccccccc-3333-4333-8333-333333333333";

function expectedCanonical(parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest("hex");
}

describe("signal request fingerprint", () => {
  it("is a lowercase SHA-256 hex digest", () => {
    const digest = signalRequestFingerprint("hello", { mode: "ALL_ELIGIBLE" });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", () => {
    expect(signalRequestFingerprint("hello", { mode: "ALL_ELIGIBLE" })).toBe(
      signalRequestFingerprint("hello", { mode: "ALL_ELIGIBLE" })
    );
  });

  it("uses a versioned array as the canonical form", () => {
    expect(signalRequestFingerprint("hi", { mode: "ALL_ELIGIBLE" })).toBe(
      expectedCanonical([SIGNAL_FINGERPRINT_VERSION, "ALL_ELIGIBLE", "hi", null])
    );
    expect(
      signalRequestFingerprint("hi", {
        mode: "SELECTED",
        userIds: [ID_A, ID_B],
      })
    ).toBe(
      expectedCanonical([
        SIGNAL_FINGERPRINT_VERSION,
        "SELECTED",
        "hi",
        [ID_A, ID_B],
      ])
    );
  });

  it("does not depend on object property order", () => {
    const first = signalRequestFingerprint("hi", {
      mode: "SELECTED",
      userIds: [ID_A, ID_B],
    });
    const reorderedProperties = signalRequestFingerprint("hi", {
      userIds: [ID_A, ID_B],
      mode: "SELECTED",
    });
    expect(reorderedProperties).toBe(first);
  });

  it("normalizes selected recipients to a deterministic unique ordering", () => {
    const base = signalRequestFingerprint("hi", {
      mode: "SELECTED",
      userIds: [ID_A, ID_B],
    });

    expect(
      signalRequestFingerprint("hi", {
        mode: "SELECTED",
        userIds: [ID_B, ID_A],
      })
    ).toBe(base);

    expect(
      signalRequestFingerprint("hi", {
        mode: "SELECTED",
        userIds: [ID_B, ID_A, ID_B],
      })
    ).toBe(base);

    expect(
      signalRequestFingerprint("hi", {
        mode: "SELECTED",
        userIds: [ID_A.toUpperCase(), ID_B.toUpperCase()],
      })
    ).toBe(base);
  });

  it("changes when the recipient set changes", () => {
    const base = signalRequestFingerprint("hi", {
      mode: "SELECTED",
      userIds: [ID_A],
    });
    expect(
      signalRequestFingerprint("hi", {
        mode: "SELECTED",
        userIds: [ID_A, ID_B],
      })
    ).not.toBe(base);
  });

  it("preserves the message exactly", () => {
    const base = signalRequestFingerprint("hello", { mode: "ALL_ELIGIBLE" });
    for (const variant of ["hello ", " hello", "hello\n", "Hello", "hellö"]) {
      expect(
        signalRequestFingerprint(variant, { mode: "ALL_ELIGIBLE" })
      ).not.toBe(base);
    }
  });

  it("separates SELECTED from ALL_ELIGIBLE", () => {
    expect(
      signalRequestFingerprint("hi", {
        mode: "SELECTED",
        userIds: [ID_A],
      })
    ).not.toBe(signalRequestFingerprint("hi", { mode: "ALL_ELIGIBLE" }));
  });

  it("treats ALL_ELIGIBLE as the mode only, not a membership snapshot", () => {
    // There is deliberately no count or recipient list in the ALL_ELIGIBLE
    // canonical form, so audience growth between attempts is still a replay.
    expect(signalRequestFingerprint("hi", { mode: "ALL_ELIGIBLE" })).toBe(
      expectedCanonical([SIGNAL_FINGERPRINT_VERSION, "ALL_ELIGIBLE", "hi", null])
    );
  });

  it("fails closed when the stored fingerprint is missing", () => {
    const digest = signalRequestFingerprint("hi", { mode: "ALL_ELIGIBLE" });
    expect(idempotencyFingerprintMatches(digest, digest)).toBe(true);
    expect(idempotencyFingerprintMatches(null, digest)).toBe(false);
    expect(idempotencyFingerprintMatches("", digest)).toBe(false);
    expect(
      idempotencyFingerprintMatches(
        signalRequestFingerprint("bye", { mode: "ALL_ELIGIBLE" }),
        digest
      )
    ).toBe(false);
  });
});
