/**
 * Operator-only authentication for system market-data management routes.
 *
 * This is a temporary gate: the operator supplies MARKET_DATA_ADMIN_TOKEN in an
 * `x-market-data-admin-token` header. It is deliberately separate from customer
 * authentication and is replaced by Firebase admin authorization later.
 *
 * No route that mutates system credentials is unauthenticated, and the token is
 * never logged, echoed, or included in a response body.
 */

import { createHash, timingSafeEqual } from "crypto";

export const MARKET_DATA_ADMIN_HEADER = "x-market-data-admin-token";

export type MarketDataAdminAuthResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 503;
      code: "ADMIN_AUTH_NOT_CONFIGURED" | "UNAUTHORIZED";
      message: string;
    };

export function getMarketDataAdminToken(): string | null {
  const token = process.env.MARKET_DATA_ADMIN_TOKEN?.trim();
  return token ? token : null;
}

export function isMarketDataAdminConfigured(): boolean {
  return getMarketDataAdminToken() !== null;
}

/**
 * Constant-time comparison. Both values are hashed first so differing lengths
 * cannot throw and cannot leak length information.
 */
export function verifyMarketDataAdminToken(
  provided: string | null | undefined
): MarketDataAdminAuthResult {
  const expected = getMarketDataAdminToken();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      code: "ADMIN_AUTH_NOT_CONFIGURED",
      message: "System market-data administration is not configured.",
    };
  }

  if (!provided) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Operator authentication is required.",
    };
  }

  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();

  return timingSafeEqual(providedDigest, expectedDigest)
    ? { ok: true }
    : {
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Operator authentication failed.",
      };
}
