/**
 * Shared HTTP helpers for the Signals administration API.
 *
 * Failures use the application's `{ error, code }` envelope and every response
 * is no-store. Unknown failures are logged without SQL or driver detail and
 * become a generic 500.
 */

import { NextResponse, type NextRequest } from "next/server";
import { NO_STORE_HEADERS, jsonError } from "@/lib/auth/http";
import { SignalsError } from "./errors";

/** A 10,000-code-point message fits comfortably, even when JSON-escaped. */
export const SIGNALS_MAX_BODY_BYTES = 256 * 1024;

export function signalsJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

export function signalsErrorResponse(err: unknown): NextResponse {
  if (err instanceof SignalsError) {
    return jsonError(err.status, err.code, err.message);
  }
  console.error(
    "[signals] unexpected failure:",
    err instanceof Error ? err.message.slice(0, 200) : "unknown"
  );
  return jsonError(500, "SIGNAL_FAILED", "The request could not be completed.");
}

export async function readSignalsJsonBody(
  req: NextRequest
): Promise<Record<string, unknown>> {
  const contentType = (req.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new SignalsError(
      400,
      "INVALID_BODY",
      "Content-Type must be application/json."
    );
  }

  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (!Number.isFinite(declared) || declared < 0) {
      throw new SignalsError(400, "INVALID_BODY", "Invalid Content-Length.");
    }
    if (declared > SIGNALS_MAX_BODY_BYTES) {
      throw new SignalsError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    }
  }

  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > SIGNALS_MAX_BODY_BYTES) {
    throw new SignalsError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  if (text.trim() === "") {
    throw new SignalsError(400, "INVALID_BODY", "Request body is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new SignalsError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SignalsError(400, "INVALID_BODY", "A JSON object body is required.");
  }
  return parsed as Record<string, unknown>;
}
