/**
 * Signal email formatting. The stored message must survive byte-for-byte in
 * the plain-text body; only the subject is derived and bounded.
 */

import {
  buildSignalEmailText,
  buildSignalInboxUrl,
  buildSignalMessageId,
  buildSignalSubject,
  SIGNALS_EMAIL_SUBJECT_FALLBACK,
  SIGNALS_EMAIL_SUBJECT_MAX_LENGTH,
} from "@/lib/signals/email-content";

const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";
const RECIPIENT_ID = "eeeeeeee-5555-4555-8555-555555555555";

describe("subject", () => {
  it("uses the first non-empty line and collapses unsafe whitespace", () => {
    expect(buildSignalSubject("\n  \n  Buy   NIFTY 50\t now  \nsecond line")).toBe(
      "Buy NIFTY 50 now"
    );
    expect(buildSignalSubject("Break\u0000out")).toBe("Break out");
  });

  it("falls back when no visible text exists", () => {
    expect(buildSignalSubject("")).toBe(SIGNALS_EMAIL_SUBJECT_FALLBACK);
    expect(buildSignalSubject(" \n\t\r\n ")).toBe(SIGNALS_EMAIL_SUBJECT_FALLBACK);
  });

  it("limits the subject to the configured maximum", () => {
    const subject = buildSignalSubject("a".repeat(300));
    expect([...subject]).toHaveLength(SIGNALS_EMAIL_SUBJECT_MAX_LENGTH);
    expect(subject.endsWith("...")).toBe(true);
  });
});

describe("body", () => {
  it("preserves the original message exactly, including spacing and emoji", () => {
    const message = "  Buy NIFTY\n\nat 10:30 🚀  \n  trailing  ";
    const inboxUrl = buildSignalInboxUrl("https://app.example.com", SIGNAL_ID);
    const text = buildSignalEmailText({ message, footer: null, inboxUrl });

    expect(text.startsWith(message)).toBe(true);
    expect(text.slice(0, message.length)).toBe(message);
    expect(text).toContain("View this signal in DemandScan:");
    expect(text).toContain(`https://app.example.com/signals/${SIGNAL_ID}`);
    expect(text).not.toContain("<html");
  });

  it("appends the optional footer between the message and the link", () => {
    const message = "Alert";
    const text = buildSignalEmailText({
      message,
      footer: "Automated message.",
      inboxUrl: "https://app.example.com/signals/x",
    });
    expect(text).toBe(
      "Alert\n\nAutomated message.\n\nView this signal in DemandScan:\nhttps://app.example.com/signals/x"
    );
  });

  it("builds the link against the configured base, including a subpath", () => {
    expect(buildSignalInboxUrl("https://app.example.com/demandscan", SIGNAL_ID)).toBe(
      `https://app.example.com/demandscan/signals/${SIGNAL_ID}`
    );
    expect(buildSignalInboxUrl("https://app.example.com/demandscan/", SIGNAL_ID)).toBe(
      `https://app.example.com/demandscan/signals/${SIGNAL_ID}`
    );
  });
});

describe("Message-ID", () => {
  it("is deterministic for the same signal and recipient", () => {
    const first = buildSignalMessageId(SIGNAL_ID, RECIPIENT_ID, "Signals@Example.COM");
    const second = buildSignalMessageId(SIGNAL_ID, RECIPIENT_ID, "Signals@Example.COM");
    expect(first).toBe(second);
    expect(first).toMatch(
      /^<signal\.[0-9a-f-]+\.recipient\.[0-9a-f-]+@example\.com>$/
    );
  });

  it("differs per recipient and falls back to a safe domain", () => {
    const a = buildSignalMessageId(SIGNAL_ID, RECIPIENT_ID, "signals@example.com");
    const b = buildSignalMessageId(
      SIGNAL_ID,
      "ffffffff-6666-4666-8666-666666666666",
      "signals@example.com"
    );
    expect(a).not.toBe(b);

    const fallback = buildSignalMessageId(SIGNAL_ID, RECIPIENT_ID, "not-an-address");
    expect(fallback.endsWith("@demandscan.local>")).toBe(true);
  });
});
