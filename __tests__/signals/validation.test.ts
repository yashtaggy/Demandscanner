/**
 * Signals request validation. No database, no HTTP.
 */

import { SignalsError } from "@/lib/signals/errors";
import {
  SIGNAL_MAX_RECIPIENTS,
  parseAudience,
  parseHistoryQuery,
  parseIdempotencyKey,
  parseMessage,
  parseRecipientQuery,
} from "@/lib/signals/validation";

function expectSignalsError(
  run: () => unknown,
  status: number,
  code: string
): void {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(SignalsError);
    expect(err).toMatchObject({ status, code });
    return;
  }
  throw new Error(`expected SignalsError ${code}`);
}

const ID_A = "aaaaaaaa-1111-4111-8111-111111111111";

describe("message validation", () => {
  it("preserves the original text exactly", () => {
    const message = "  Signal\n\nline 2\t🔥 ₹ \u{1F680}  ";
    expect(parseMessage(message)).toBe(message);
  });

  it("accepts exactly 10,000 code points, counting emoji once each", () => {
    const message = "🚀".repeat(10_000);
    expect(parseMessage(message)).toHaveLength(20_000);
    expect([...parseMessage(message)].length).toBe(10_000);
  });

  it("rejects messages beyond 10,000 code points", () => {
    expectSignalsError(
      () => parseMessage("a".repeat(10_001)),
      400,
      "MESSAGE_TOO_LONG"
    );
  });

  it("rejects non-strings and blank messages", () => {
    expectSignalsError(() => parseMessage(null), 400, "INVALID_MESSAGE");
    expectSignalsError(() => parseMessage(42), 400, "INVALID_MESSAGE");
    expectSignalsError(() => parseMessage(" \n\t "), 400, "MESSAGE_BLANK");
  });

  it("allows tab, newline and carriage return but rejects other controls", () => {
    expect(() => parseMessage("a\tb\nc\rd")).not.toThrow();
    expectSignalsError(
      () => parseMessage("bad\u0000message"),
      400,
      "MESSAGE_CONTROL_CHARACTERS"
    );
    expectSignalsError(
      () => parseMessage("bad\u000Bmessage"),
      400,
      "MESSAGE_CONTROL_CHARACTERS"
    );
    expectSignalsError(
      () => parseMessage("bad\u009Fmessage"),
      400,
      "MESSAGE_CONTROL_CHARACTERS"
    );
  });
});

describe("idempotency key validation", () => {
  it("treats absent keys as null and preserves a supplied key verbatim", () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
    expect(parseIdempotencyKey(null)).toBeNull();
    expect(parseIdempotencyKey("  key-1  ")).toBe("  key-1  ");
  });

  it("rejects empty, over-long and non-text keys", () => {
    expectSignalsError(
      () => parseIdempotencyKey("   "),
      400,
      "INVALID_IDEMPOTENCY_KEY"
    );
    expectSignalsError(
      () => parseIdempotencyKey("k".repeat(129)),
      400,
      "INVALID_IDEMPOTENCY_KEY"
    );
    expectSignalsError(
      () => parseIdempotencyKey(7),
      400,
      "INVALID_IDEMPOTENCY_KEY"
    );
  });
});

describe("audience validation", () => {
  it("accepts ALL_ELIGIBLE and ignores an unused id list", () => {
    expect(
      parseAudience({ mode: "ALL_ELIGIBLE", userIds: [ID_A] })
    ).toEqual({ mode: "ALL_ELIGIBLE" });
  });

  it("deduplicates selected ids case-insensitively", () => {
    expect(
      parseAudience({ mode: "SELECTED", userIds: [ID_A, ID_A.toUpperCase()] })
    ).toEqual({ mode: "SELECTED", userIds: [ID_A] });
  });

  it("rejects an empty selection and invalid ids", () => {
    expectSignalsError(
      () => parseAudience({ mode: "SELECTED", userIds: [] }),
      400,
      "NO_RECIPIENTS"
    );
    expectSignalsError(
      () => parseAudience({ mode: "SELECTED", userIds: ["not-a-uuid"] }),
      400,
      "INVALID_RECIPIENT_ID"
    );
  });

  it("accepts exactly 1,000 selected ids", () => {
    const userIds = Array.from({ length: SIGNAL_MAX_RECIPIENTS }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    const audience = parseAudience({ mode: "SELECTED", userIds });
    expect(audience.mode).toBe("SELECTED");
    expect(audience.mode === "SELECTED" && audience.userIds).toHaveLength(1000);
  });

  it("deduplicates repeated ids so a duplicate cannot become a second row", () => {
    const userIds = Array.from({ length: 500 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    const audience = parseAudience({
      mode: "SELECTED",
      userIds: [...userIds, ...userIds],
    });
    expect(audience.mode === "SELECTED" && audience.userIds).toEqual(userIds);
  });

  it("rejects more than 1,000 selected ids", () => {
    const userIds = Array.from({ length: 1001 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    expect(userIds).toHaveLength(SIGNAL_MAX_RECIPIENTS + 1);
    expectSignalsError(
      () => parseAudience({ mode: "SELECTED", userIds }),
      400,
      "TOO_MANY_RECIPIENTS"
    );
  });

  it("rejects unknown modes and non-objects", () => {
    expectSignalsError(
      () => parseAudience({ mode: "EVERYONE" }),
      400,
      "INVALID_AUDIENCE"
    );
    expectSignalsError(() => parseAudience(null), 400, "INVALID_AUDIENCE");
    expectSignalsError(() => parseAudience([ID_A]), 400, "INVALID_AUDIENCE");
  });
});

describe("query parsing", () => {
  it("applies history defaults and bounds", () => {
    expect(parseHistoryQuery(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(parseHistoryQuery(new URLSearchParams("page=3&pageSize=100"))).toEqual({
      page: 3,
      pageSize: 100,
    });
    expectSignalsError(
      () => parseHistoryQuery(new URLSearchParams("page=0")),
      400,
      "INVALID_PAGINATION"
    );
    expectSignalsError(
      () => parseHistoryQuery(new URLSearchParams("pageSize=101")),
      400,
      "INVALID_PAGINATION"
    );
    expectSignalsError(
      () => parseHistoryQuery(new URLSearchParams("page=abc")),
      400,
      "INVALID_PAGINATION"
    );
  });

  it("normalizes the recipient search and limit", () => {
    expect(
      parseRecipientQuery(new URLSearchParams("search=  ravi  &limit=50"))
    ).toEqual({ search: "ravi", limit: 50 });
    expect(parseRecipientQuery(new URLSearchParams())).toEqual({
      search: "",
      limit: 20,
    });
    expect(
      parseRecipientQuery(new URLSearchParams(`search=${"x".repeat(200)}`)).search
    ).toHaveLength(120);
    expectSignalsError(
      () => parseRecipientQuery(new URLSearchParams("limit=0")),
      400,
      "INVALID_PAGINATION"
    );
  });
});
