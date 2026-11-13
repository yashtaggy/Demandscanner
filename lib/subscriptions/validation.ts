/**
 * Validation and Asia/Kolkata date helpers for subscriptions.
 *
 * Authorization never depends on the Node/browser clock: access decisions use
 * PostgreSQL's `NOW()` inside `is_subscription_entitled`. These helpers are for
 * request validation and display only. `todayInIst` exists so admin forms can
 * default to the same calendar day the database will evaluate.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Strict YYYY-MM-DD, rejecting impossible calendar dates such as 2026-02-30. */
export function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Converts a DATE/string/Date from the driver to YYYY-MM-DD. */
export function toIsoDate(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

/** Today's calendar date in Asia/Kolkata, independent of the server timezone. */
export function todayInIst(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function utcDayNumber(value: string): number | null {
  const iso = parseDateOnly(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Inclusive remaining calendar days; 0 when the end date is already past. */
export function daysRemainingInclusive(endDate: string, today: string): number | null {
  const end = utcDayNumber(endDate);
  const current = utcDayNumber(today);
  if (end === null || current === null) return null;
  return Math.max(0, end - current + 1);
}

/** Decimal string with exactly two fraction digits, never a float. */
export function parseMoney(raw: unknown): { amount: string; value: number } | null {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.trim();
  } else {
    return null;
  }
  if (!MONEY_PATTERN.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  const [whole, fraction = ""] = text.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  return {
    amount: `${normalizedWhole}.${(fraction + "00").slice(0, 2)}`,
    value,
  };
}

export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  return CURRENCY_PATTERN.test(value) ? value : null;
}

export function parsePositiveInteger(
  raw: unknown,
  min: number,
  max: number
): number | null {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

export type TextResult =
  | { ok: true; value: string | null }
  | { ok: false };

/** Trimmed optional text; empty becomes null; over-length is rejected. */
export function normalizeOptionalText(
  raw: unknown,
  maxLength: number
): TextResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > maxLength) return { ok: false };
  return { ok: true, value };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
