import { NextResponse, type NextRequest } from "next/server";
import { getAppOrigin } from "@/lib/env";
import type { RateLimitResult } from "./rate-limit";
import { AppAuthError } from "./types";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json(
    { error: message, code },
    { status, headers: NO_STORE_HEADERS }
  );
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * CSRF/origin guard for mutating auth routes.
 *
 * Rejects cross-site requests and an Origin that matches neither the request
 * origin nor the configured app origin. In production an absent Origin is
 * rejected; browser fetch() always sends one for these routes.
 */
export function isSameOriginRequest(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") {
    return false;
  }

  const origin = req.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  let originValue: string;
  try {
    originValue = new URL(origin).origin;
  } catch {
    return false;
  }

  if (originValue === new URL(req.url).origin) return true;

  try {
    return originValue === getAppOrigin();
  } catch {
    return false;
  }
}

/**
 * Safe mapping of a rate-limit decision to an HTTP response.
 *
 * A limiter outage is a 503, never an implicit allow. The database error is
 * logged by consumeRateLimit() and is not echoed to the client.
 */
export function rateLimitResponse(
  result: RateLimitResult,
  limitedMessage: string
): NextResponse {
  const retryAfter = Math.max(1, result.retryAfterSeconds);
  if (result.unavailable) {
    return NextResponse.json(
      {
        error: "This action is temporarily unavailable. Try again shortly.",
        code: "RATE_LIMIT_UNAVAILABLE",
      },
      {
        status: 503,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(retryAfter) },
      }
    );
  }

  return NextResponse.json(
    { error: limitedMessage, code: "RATE_LIMITED" },
    {
      status: 429,
      headers: { ...NO_STORE_HEADERS, "Retry-After": String(retryAfter) },
    }
  );
}

/** Safe mapping of internal auth failures to HTTP responses. */
export function authErrorResponse(err: unknown): NextResponse {
  if (err instanceof AppAuthError) {
    if (err.reason === "SUBSCRIPTION_REQUIRED") {
      return jsonError(
        403,
        "SUBSCRIPTION_REQUIRED",
        "An active subscription is required. Contact your administrator."
      );
    }
    if (err.reason === "SUSPENDED" || err.reason === "DISABLED" || err.reason === "FORBIDDEN") {
      return jsonError(403, "ACCESS_DENIED", "You do not have access to this resource.");
    }
    return jsonError(401, "UNAUTHENTICATED", "Authentication is required.");
  }

  console.error(
    "[auth] unexpected authorization failure:",
    err instanceof Error ? err.message : String(err)
  );
  return jsonError(500, "AUTH_ERROR", "Authentication could not be verified.");
}
