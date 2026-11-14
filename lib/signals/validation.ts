/**
 * Signals request validation.
 *
 * Pure functions that mirror the database constraints. They throw SignalsError
 * with a 400 status so routes only need one error mapping.
 *
 * The message is validated, never normalized: leading/trailing whitespace,
 * internal line breaks and emoji are preserved byte-for-byte. Length is counted
 * in code points to match PostgreSQL `char_length`.
 */

import { SignalsError, type SignalsErrorCode } from "./errors";
import type { SignalAudienceMode } from "./types";

export const SIGNAL_MESSAGE_MAX_LENGTH = 10_000;
export const SIGNAL_MAX_RECIPIENTS = 1_000;
export const SIGNAL_DEFAULT_PAGE_SIZE = 20;
export const SIGNAL_MAX_PAGE_SIZE = 100;
export const SIGNAL_DEFAULT_RECIPIENT_LIMIT = 20;
export const SIGNAL_MAX_RECIPIENT_LIMIT = 100;
export const SIGNAL_MAX_SEARCH_LENGTH = 120;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// C0 controls except TAB/LF/CR, plus DEL and C1 controls. This matches the
// migration's `translate(message, E'\n\r\t', '') !~ '[[:cntrl:]]'` check.
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

const AUDIENCE_MODES: readonly SignalAudienceMode[] = [
  "SELECTED",
  "ALL_ELIGIBLE",
];

export type SignalAudience =
  | { mode: "SELECTED"; userIds: string[] }
  | { mode: "ALL_ELIGIBLE" };

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function invalid(code: SignalsErrorCode, message: string): never {
  throw new SignalsError(400, code, message);
}

/**
 * Returns the message exactly as submitted. Only validation reads a trimmed
 * copy; the stored value is never trimmed or normalized.
 */
export function parseMessage(raw: unknown): string {
  if (typeof raw !== "string") {
    invalid("INVALID_MESSAGE", "Message must be text.");
  }
  // UTF-16 units are at least the code-point count, so this bounds the scan
  // without rejecting a valid message that contains astral characters.
  if (raw.length > SIGNAL_MESSAGE_MAX_LENGTH * 2) {
    invalid("MESSAGE_TOO_LONG", "Message must be 10,000 characters or fewer.");
  }
  if (raw.trim().length === 0) {
    invalid("MESSAGE_BLANK", "Message cannot be blank.");
  }
  if ([...raw].length > SIGNAL_MESSAGE_MAX_LENGTH) {
    invalid("MESSAGE_TOO_LONG", "Message must be 10,000 characters or fewer.");
  }
  if (CONTROL_CHARACTER.test(raw)) {
    invalid(
      "MESSAGE_CONTROL_CHARACTERS",
      "Message contains unsupported control characters."
    );
  }
  return raw;
}

export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    invalid("INVALID_IDEMPOTENCY_KEY", "Idempotency key must be text.");
  }
  if (raw.trim().length === 0 || [...raw].length > 128) {
    invalid(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency key must be between 1 and 128 characters."
    );
  }
  if (CONTROL_CHARACTER.test(raw)) {
    invalid(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency key contains unsupported control characters."
    );
  }
  return raw;
}

export function parseAudience(raw: unknown): SignalAudience {
  if (raw === undefined || raw === null) {
    invalid("INVALID_AUDIENCE", "An audience is required.");
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    invalid("INVALID_AUDIENCE", "Audience must be an object.");
  }

  const audience = raw as Record<string, unknown>;
  const mode = audience.mode;
  if (typeof mode !== "string" || !AUDIENCE_MODES.includes(mode as SignalAudienceMode)) {
    invalid(
      "INVALID_AUDIENCE",
      "Audience mode must be SELECTED or ALL_ELIGIBLE."
    );
  }

  if (mode === "ALL_ELIGIBLE") {
    return { mode: "ALL_ELIGIBLE" };
  }

  if (!Array.isArray(audience.userIds)) {
    invalid("INVALID_AUDIENCE", "Selected recipients must be an array.");
  }
  if (audience.userIds.length === 0) {
    invalid("NO_RECIPIENTS", "Select at least one recipient.");
  }
  if (audience.userIds.length > SIGNAL_MAX_RECIPIENTS) {
    invalid(
      "TOO_MANY_RECIPIENTS",
      `A signal can be sent to at most ${SIGNAL_MAX_RECIPIENTS} recipients.`
    );
  }

  const userIds: string[] = [];
  const seen = new Set<string>();
  for (const value of audience.userIds) {
    if (!isValidUuid(value)) {
      invalid(
        "INVALID_RECIPIENT_ID",
        "Recipient identifiers must be valid UUIDs."
      );
    }
    const normalized = value.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      userIds.push(normalized);
    }
  }

  return { mode: "SELECTED", userIds };
}

function parseBoundedInteger(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const text = typeof raw === "string" ? raw.trim() : null;
  if (text === null || !/^\d+$/.test(text)) {
    invalid("INVALID_PAGINATION", `${label} must be a whole number.`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    invalid(
      "INVALID_PAGINATION",
      `${label} must be between ${min} and ${max}.`
    );
  }
  return value;
}

export interface HistoryQuery {
  page: number;
  pageSize: number;
}

export function parseHistoryQuery(params: URLSearchParams): HistoryQuery {
  return {
    page: parseBoundedInteger(params.get("page"), 1, 1, 1_000_000, "Page"),
    pageSize: parseBoundedInteger(
      params.get("pageSize"),
      SIGNAL_DEFAULT_PAGE_SIZE,
      1,
      SIGNAL_MAX_PAGE_SIZE,
      "Page size"
    ),
  };
}

export interface RecipientQuery {
  search: string;
  limit: number;
}

export function parseRecipientQuery(params: URLSearchParams): RecipientQuery {
  const search = (params.get("search") ?? "")
    .trim()
    .slice(0, SIGNAL_MAX_SEARCH_LENGTH);
  return {
    search,
    limit: parseBoundedInteger(
      params.get("limit"),
      SIGNAL_DEFAULT_RECIPIENT_LIMIT,
      1,
      SIGNAL_MAX_RECIPIENT_LIMIT,
      "Limit"
    ),
  };
}

/** Customer inbox pagination. The customer id is never part of the query. */
export function parseInboxQuery(params: URLSearchParams): HistoryQuery {
  return {
    page: parseBoundedInteger(params.get("page"), 1, 1, 1_000_000, "Page"),
    pageSize: parseBoundedInteger(
      params.get("pageSize"),
      SIGNAL_DEFAULT_PAGE_SIZE,
      1,
      SIGNAL_MAX_PAGE_SIZE,
      "Page size"
    ),
  };
}

/**
 * Only `isRead` is read from the body. Timestamps and every other recipient
 * field are server-owned, so a caller-supplied `readAt` is simply ignored.
 */
export function parseReadState(body: Record<string, unknown>): boolean {
  if (typeof body.isRead !== "boolean") {
    invalid("INVALID_READ_STATE", "isRead must be true or false.");
  }
  return body.isRead;
}

/** Escapes LIKE metacharacters for a parameterized ILIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
