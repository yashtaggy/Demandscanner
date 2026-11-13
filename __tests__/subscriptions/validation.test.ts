/**
 * Subscription validation and IST date helpers. These are pure functions: no
 * database and no clock dependence beyond the instant passed in.
 */

import {
  daysRemainingInclusive,
  escapeLike,
  isValidUuid,
  normalizeCurrency,
  normalizeOptionalText,
  parseDateOnly,
  parseMoney,
  parsePositiveInteger,
  toIsoDate,
  todayInIst,
} from "@/lib/subscriptions/validation";

describe("parseDateOnly", () => {
  it("accepts real YYYY-MM-DD calendar dates", () => {
    expect(parseDateOnly("2026-12-31")).toBe("2026-12-31");
    expect(parseDateOnly(" 2026-01-01 ")).toBe("2026-01-01");
    expect(parseDateOnly("2028-02-29")).toBe("2028-02-29");
  });

  it("rejects impossible or malformed dates", () => {
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("2026-13-01")).toBeNull();
    expect(parseDateOnly("2026-2-3")).toBeNull();
    expect(parseDateOnly("31-12-2026")).toBeNull();
    expect(parseDateOnly("1999-12-31")).toBeNull();
    expect(parseDateOnly("2101-01-01")).toBeNull();
    expect(parseDateOnly(20261231)).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
  });
});

describe("todayInIst", () => {
  it("uses Asia/Kolkata even when UTC has not crossed midnight", () => {
    // 2026-12-31T19:00:00Z is already 2027-01-01 00:30 IST.
    expect(todayInIst(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
    // 2026-12-31T18:29:59Z is 2026-12-31 23:59:59 IST.
    expect(todayInIst(new Date("2026-12-31T18:29:59Z"))).toBe("2026-12-31");
    expect(todayInIst(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });
});

describe("daysRemainingInclusive", () => {
  it("counts both the start and end day", () => {
    expect(daysRemainingInclusive("2026-12-31", "2026-12-31")).toBe(1);
    expect(daysRemainingInclusive("2027-01-01", "2026-12-31")).toBe(2);
    expect(daysRemainingInclusive("2026-12-31", "2027-01-01")).toBe(0);
  });

  it("returns null for invalid input", () => {
    expect(daysRemainingInclusive("not-a-date", "2026-12-31")).toBeNull();
  });
});

describe("parseMoney", () => {
  it("normalizes to two decimals as a string", () => {
    expect(parseMoney(499)).toEqual({ amount: "499.00", value: 499 });
    expect(parseMoney("499.9")).toEqual({ amount: "499.90", value: 499.9 });
    expect(parseMoney("  0499.99 ")).toEqual({ amount: "499.99", value: 499.99 });
    expect(parseMoney("0")).toEqual({ amount: "0.00", value: 0 });
  });

  it("rejects negative, float-unsafe and malformed amounts", () => {
    expect(parseMoney(-1)).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("1e3")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseMoney({})).toBeNull();
  });
});

describe("normalizeCurrency and parsePositiveInteger", () => {
  it("uppercases a three-letter currency", () => {
    expect(normalizeCurrency("inr")).toBe("INR");
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("rupees")).toBeNull();
    expect(normalizeCurrency(356)).toBeNull();
  });

  it("accepts only whole days inside the allowed range", () => {
    expect(parsePositiveInteger("30", 1, 3660)).toBe(30);
    expect(parsePositiveInteger(365, 1, 3660)).toBe(365);
    expect(parsePositiveInteger(0, 1, 3660)).toBeNull();
    expect(parsePositiveInteger(3661, 1, 3660)).toBeNull();
    expect(parsePositiveInteger("2.5", 1, 3660)).toBeNull();
    expect(parsePositiveInteger(-3, 1, 3660)).toBeNull();
  });
});

describe("normalizeOptionalText", () => {
  it("trims, nulls empty values and rejects over-length text", () => {
    expect(normalizeOptionalText(undefined, 10)).toEqual({ ok: true, value: null });
    expect(normalizeOptionalText("   ", 10)).toEqual({ ok: true, value: null });
    expect(normalizeOptionalText(" Paid ", 10)).toEqual({ ok: true, value: "Paid" });
    expect(normalizeOptionalText("abcdefghijk", 10)).toEqual({ ok: false });
    expect(normalizeOptionalText(42, 10)).toEqual({ ok: false });
  });
});

describe("isValidUuid and escapeLike", () => {
  it("accepts only canonical UUID syntax", () => {
    expect(isValidUuid("3f2a9c1e-8b4d-4f6a-9c2e-1d5b7a9e0c3f")).toBe(true);
    expect(isValidUuid("ZP0001")).toBe(false);
    expect(isValidUuid("3f2a9c1e8b4d4f6a9c2e1d5b7a9e0c3f")).toBe(false);
    expect(isValidUuid(null)).toBe(false);
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });
});

describe("toIsoDate", () => {
  it("formats driver values as YYYY-MM-DD", () => {
    expect(toIsoDate("2026-12-31T00:00:00Z")).toBe("2026-12-31");
    expect(toIsoDate(new Date("2026-12-31T00:00:00Z"))).toBe("2026-12-31");
  });
});
