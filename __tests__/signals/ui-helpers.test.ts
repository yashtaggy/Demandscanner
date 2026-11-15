import {
  allVisibleSelected,
  appendInboxPage,
  audienceFor,
  clearRecipients,
  countCodePoints,
  emailStatusVariant,
  mergeRecipients,
  newIdempotencyKey,
  publishDeliveryLabel,
  publishValidation,
  recipientSummaryLabel,
  requestFingerprint,
  resolveIdempotencyAttempt,
  selectRecipients,
  selectedRecipients,
  selectionKey,
  signalStatusVariant,
  toggleRecipient,
  unreadBadgeLabel,
} from "@/lib/signals/ui";
import type {
  CustomerSignalSummary,
  EligibleRecipient,
  SignalPublishDelivery,
} from "@/lib/signals/types";

const ALICE: EligibleRecipient = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  displayName: "Alice",
};
const BOB: EligibleRecipient = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "bob@example.com",
  displayName: null,
};
const CAROL: EligibleRecipient = {
  userId: "33333333-3333-4333-8333-333333333333",
  email: "carol@example.com",
  displayName: "Carol",
};

function signal(id: string): CustomerSignalSummary {
  return {
    signalId: id,
    messagePreview: `preview ${id}`,
    publishedAt: "2026-11-14T09:30:00.000Z",
    readAt: null,
    isRead: false,
  };
}

describe("message validation and counting", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(countCodePoints("abc")).toBe(3);
    expect(countCodePoints("🔥")).toBe(1);
    expect(countCodePoints("a🔥b")).toBe(3);
    expect(countCodePoints("line\nbreak")).toBe(10);
  });

  it("rejects blank and oversized messages and empty selections", () => {
    expect(publishValidation("", "SELECTED", 1)).toBe(
      "Write a message before publishing."
    );
    expect(publishValidation("   \n\t", "ALL_ELIGIBLE", 0)).toBe(
      "Write a message before publishing."
    );
    expect(publishValidation("🔥".repeat(10_000), "ALL_ELIGIBLE", 0)).toBeNull();
    expect(publishValidation("🔥".repeat(10_001), "ALL_ELIGIBLE", 0)).toBe(
      "Message must be 10,000 characters or fewer."
    );
    expect(publishValidation("hello", "SELECTED", 0)).toBe(
      "Select at least one recipient."
    );
    expect(publishValidation("hello", "SELECTED", 1)).toBeNull();
    expect(publishValidation("hello", "ALL_ELIGIBLE", 0)).toBeNull();
    expect(publishValidation("hello", "SELECTED", 1_000)).toBeNull();
    expect(publishValidation("hello", "SELECTED", 1_001)).toBe(
      "A signal can be sent to at most 1,000 recipients."
    );
  });
});

describe("recipient selection", () => {
  it("adds and removes recipients with case-insensitive keys", () => {
    let selection = new Map<string, EligibleRecipient>();
    selection = toggleRecipient(selection, ALICE, true);
    expect(selectionKey(ALICE.userId)).toBe(ALICE.userId.toLowerCase());
    expect(selection.has(ALICE.userId)).toBe(true);

    selection = toggleRecipient(
      selection,
      { ...ALICE, userId: ALICE.userId.toUpperCase() },
      true
    );
    expect(selection.size).toBe(1);

    selection = toggleRecipient(selection, ALICE, false);
    expect(selection.size).toBe(0);
  });

  it("selects and clears a visible page without touching other selections", () => {
    let selection = new Map<string, EligibleRecipient>();
    selection = selectRecipients(selection, [ALICE]);
    selection = selectRecipients(selection, [BOB, CAROL]);
    expect(selectedRecipients(selection)).toHaveLength(3);
    expect(allVisibleSelected(selection, [ALICE, BOB])).toBe(true);

    selection = clearRecipients(selection, [ALICE, BOB]);
    expect(selectedRecipients(selection).map((item) => item.userId)).toEqual([
      CAROL.userId,
    ]);
    expect(allVisibleSelected(selection, [ALICE, BOB])).toBe(false);
    expect(allVisibleSelected(selection, [])).toBe(false);
  });

  it("merges lookup pages without duplicating recipients", () => {
    const merged = mergeRecipients([ALICE, BOB], [BOB, CAROL]);
    expect(merged.map((item) => item.userId)).toEqual([
      ALICE.userId,
      BOB.userId,
      CAROL.userId,
    ]);
  });

  it("builds the audience from the current selection", () => {
    const selection = selectRecipients(new Map(), [ALICE, BOB]);
    expect(audienceFor("SELECTED", selection)).toEqual({
      mode: "SELECTED",
      userIds: [ALICE.userId, BOB.userId],
    });
    expect(audienceFor("ALL_ELIGIBLE", selection)).toEqual({
      mode: "ALL_ELIGIBLE",
    });
  });
});

describe("idempotency attempts", () => {
  it("treats the same message and recipient set as one request", () => {
    const first = requestFingerprint("hello", "SELECTED", [
      ALICE.userId,
      BOB.userId,
    ]);
    const reordered = requestFingerprint("hello", "SELECTED", [
      BOB.userId,
      ALICE.userId,
      ALICE.userId.toUpperCase(),
    ]);
    expect(reordered).toBe(first);
    expect(requestFingerprint("hello!", "SELECTED", [ALICE.userId])).not.toBe(
      first
    );
    expect(requestFingerprint("hello", "ALL_ELIGIBLE", [])).not.toBe(first);
  });

  it("reuses the key only while the fingerprint is unchanged", () => {
    const generated: string[] = [];
    const generate = () => {
      const key = `key-${generated.length + 1}`;
      generated.push(key);
      return key;
    };
    const first = resolveIdempotencyAttempt(null, "fp-1", generate);
    expect(first).toEqual({ key: "key-1", fingerprint: "fp-1" });

    const retry = resolveIdempotencyAttempt(first, "fp-1", generate);
    expect(retry).toBe(first);
    expect(generated).toHaveLength(1);

    const changed = resolveIdempotencyAttempt(retry, "fp-2", generate);
    expect(changed).toEqual({ key: "key-2", fingerprint: "fp-2" });
    expect(generated).toHaveLength(2);
  });

  it("generates unique version-4 UUID keys", () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(first).not.toBe(second);
  });
});

describe("inbox helpers", () => {
  it("appends pages without duplicating signals", () => {
    const merged = appendInboxPage(
      [signal("a"), signal("b")],
      [signal("b"), signal("c")]
    );
    expect(merged.map((item) => item.signalId)).toEqual(["a", "b", "c"]);
  });

  it("renders badges only for positive counts and caps at 99+", () => {
    expect(unreadBadgeLabel(null)).toBeNull();
    expect(unreadBadgeLabel(0)).toBeNull();
    expect(unreadBadgeLabel(-3)).toBeNull();
    expect(unreadBadgeLabel(1)).toBe("1");
    expect(unreadBadgeLabel(99)).toBe("99");
    expect(unreadBadgeLabel(100)).toBe("99+");
    expect(unreadBadgeLabel(4_000)).toBe("99+");
  });
});

describe("display mapping", () => {
  it("maps email, signal status and recipient labels", () => {
    expect(emailStatusVariant("PENDING")).toBe("neutral");
    expect(emailStatusVariant("SENDING")).toBe("info");
    expect(emailStatusVariant("SENT")).toBe("success");
    expect(emailStatusVariant("FAILED")).toBe("danger");
    expect(emailStatusVariant("SKIPPED")).toBe("warning");
    expect(signalStatusVariant("PUBLISHED")).toBe("success");
    expect(signalStatusVariant("ARCHIVED")).toBe("neutral");
    expect(recipientSummaryLabel(1)).toBe("1 recipient");
    expect(recipientSummaryLabel(2)).toBe("2 recipients");
    expect(recipientSummaryLabel(0)).toBe("0 recipients");
  });
});

describe("publish delivery label", () => {
  function dispatched(
    overrides: Partial<{
      attempted: number;
      sent: number;
      failed: number;
      skipped: number;
      pending: number;
    }> = {}
  ): SignalPublishDelivery {
    return {
      status: "DISPATCHED",
      attempted: overrides.attempted ?? 0,
      sent: overrides.sent ?? 0,
      failed: overrides.failed ?? 0,
      skipped: overrides.skipped ?? 0,
      pending: overrides.pending ?? 0,
    };
  }

  function reportingFailed(
    overrides: Partial<{
      attempted: number;
      sent: number;
      failed: number;
      skipped: number;
    }> = {}
  ): SignalPublishDelivery {
    return {
      status: "DISPATCHED_REPORTING_FAILED",
      attempted: overrides.attempted ?? 0,
      sent: overrides.sent ?? 0,
      failed: overrides.failed ?? 0,
      skipped: overrides.skipped ?? 0,
      pending: null,
    };
  }

  it("reports delivered email only when records reached SENT", () => {
    expect(publishDeliveryLabel(dispatched({ attempted: 2, sent: 2 }))).toBe(
      "Signal published. Emails sent to 2 recipients."
    );
    expect(publishDeliveryLabel(dispatched({ attempted: 1, sent: 1 }))).toBe(
      "Signal published. Emails sent to 1 recipient."
    );
  });

  it("reports remaining queued recipients", () => {
    expect(
      publishDeliveryLabel(dispatched({ attempted: 5, sent: 5, pending: 3 }))
    ).toBe("Signal published. 5 emails sent; 3 remain queued.");
    expect(
      publishDeliveryLabel(dispatched({ attempted: 5, sent: 1, pending: 4 }))
    ).toBe("Signal published. 1 email sent; 4 remain queued.");
  });

  it("flags failed attempts without claiming delivery", () => {
    expect(
      publishDeliveryLabel(dispatched({ attempted: 2, failed: 2, pending: 2 }))
    ).toBe("Signal published. Some email attempts failed. Check delivery status.");
    expect(
      publishDeliveryLabel(
        dispatched({ attempted: 3, sent: 2, failed: 1, pending: 1 })
      )
    ).toBe("Signal published. 2 emails sent; 1 failed. Check delivery status.");
  });

  it("explains configuration problems", () => {
    expect(
      publishDeliveryLabel({
        status: "EMAIL_NOT_CONFIGURED",
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        pending: 2,
      })
    ).toBe(
      "Signal published. Email configuration is incomplete. Recipients remain queued."
    );
    expect(
      publishDeliveryLabel({
        status: "EMAIL_NOT_CONFIGURED",
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        pending: null,
      })
    ).toBe(
      "Signal published. Email configuration is incomplete. Recipients remain queued."
    );
  });

  it("does not claim a send when nothing was attempted or everything was skipped", () => {
    expect(publishDeliveryLabel(dispatched({ pending: 2 }))).toBe(
      "Signal published. No emails were attempted. Recipients remain queued."
    );
    expect(publishDeliveryLabel(dispatched({ pending: 0 }))).toBe(
      "Signal published."
    );
    expect(
      publishDeliveryLabel(dispatched({ attempted: 2, skipped: 2 }))
    ).toBe(
      "Signal published. No emails were sent; recipients are no longer active customers."
    );
  });

  it("distinguishes unconfirmed delivery from unconfirmed reporting", () => {
    expect(
      publishDeliveryLabel({
        status: "DISPATCH_FAILED",
        attempted: null,
        sent: null,
        failed: null,
        skipped: null,
        pending: 3,
      })
    ).toBe(
      "Signal published. Email delivery could not be confirmed. Any recipients still queued will be retried."
    );
    expect(
      publishDeliveryLabel({
        status: "DISPATCH_FAILED",
        attempted: null,
        sent: null,
        failed: null,
        skipped: null,
        pending: null,
      })
    ).toBe(
      "Signal published. Email delivery could not be confirmed. Any recipients still queued will be retried."
    );
    expect(
      publishDeliveryLabel(reportingFailed({ attempted: 2, sent: 2 }))
    ).toBe(
      "Signal published. 2 emails sent. The remaining queue count could not be confirmed."
    );
  });

  it("keeps delivery counts visible when only reporting failed", () => {
    expect(
      publishDeliveryLabel(reportingFailed({ attempted: 3, sent: 2, failed: 1 }))
    ).toBe(
      "Signal published. 2 emails sent; 1 failed. The remaining queue count could not be confirmed."
    );
    expect(
      publishDeliveryLabel(reportingFailed({ attempted: 1, failed: 1 }))
    ).toBe(
      "Signal published. Some email attempts failed. The remaining queue count could not be confirmed."
    );
    expect(publishDeliveryLabel(reportingFailed())).toBe(
      "Signal published. No emails were attempted. The remaining queue count could not be confirmed."
    );
    expect(
      publishDeliveryLabel(reportingFailed({ attempted: 2, skipped: 2 }))
    ).toBe(
      "Signal published. No emails were sent; recipients are no longer active customers. The remaining queue count could not be confirmed."
    );
  });

  it("never says delivered email will be retried", () => {
    const delivered = [
      publishDeliveryLabel(dispatched({ attempted: 2, sent: 2 })),
      publishDeliveryLabel(dispatched({ attempted: 5, sent: 5, pending: 3 })),
      publishDeliveryLabel(
        dispatched({ attempted: 3, sent: 2, failed: 1, pending: 1 })
      ),
      publishDeliveryLabel(reportingFailed({ attempted: 2, sent: 2 })),
      publishDeliveryLabel(reportingFailed({ attempted: 3, sent: 2, failed: 1 })),
    ];
    for (const label of delivered) {
      expect(label.toLowerCase()).not.toContain("retried");
    }

    // Unknown delivery may only promise a retry for rows still queued.
    const unknown = publishDeliveryLabel({
      status: "DISPATCH_FAILED",
      attempted: null,
      sent: null,
      failed: null,
      skipped: null,
      pending: 3,
    });
    expect(unknown).toContain("Any recipients still queued will be retried");
    expect(unknown.toLowerCase()).not.toMatch(/sent.*retried/);
  });
});
