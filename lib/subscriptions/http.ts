/**
 * Shared HTTP helpers for the subscription administration API.
 *
 * All responses use the existing `{ error, code }` envelope for failures and
 * `Cache-Control: no-store` for everything, because the payloads contain
 * customer billing data. The client-supplied `userId` in a nested URL is never
 * trusted as an ownership proof; the service layer re-checks it against the
 * stored subscription.
 */

import { NextResponse, type NextRequest } from "next/server";
import { jsonError, NO_STORE_HEADERS } from "../auth/http";
import { SubscriptionError } from "./errors";

export function subscriptionJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

/**
 * Maps service errors. Only `SubscriptionError` messages reach the client;
 * anything else is logged without its message and becomes a generic 500.
 */
export function subscriptionErrorResponse(err: unknown): NextResponse {
  if (err instanceof SubscriptionError) {
    return jsonError(err.status, err.code, err.message);
  }
  console.error(
    "[subscriptions] unexpected failure:",
    err instanceof Error ? err.message.slice(0, 200) : "unknown"
  );
  return jsonError(500, "SUBSCRIPTION_FAILED", "The request could not be completed.");
}

export async function readJsonObject(
  req: NextRequest
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function invalidBody(): NextResponse {
  return jsonError(400, "INVALID_BODY", "A JSON object body is required.");
}
