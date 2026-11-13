/**
 * Market-data context helpers.
 *
 * A service accepts either a real KiteSession (existing call sites and tests)
 * or a broker-independent MarketDataContext. This module performs the pure
 * conversion; it never touches the database and never reads credentials.
 */

import type { KiteSession } from "@/lib/types";
import type { MarketDataContext } from "./types";

export type MarketDataInput = MarketDataContext | KiteSession;

export function isMarketDataContext(value: unknown): value is MarketDataContext {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MarketDataContext>;
  return (
    typeof candidate.provider === "string" &&
    typeof candidate.credentials === "object" &&
    candidate.credentials !== null &&
    typeof candidate.credentials.accessToken === "string"
  );
}

export function isKiteSession(value: unknown): value is KiteSession {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Partial<KiteSession>).accessToken === "string";
}

/**
 * Wrap a customer Kite session in the provider context.
 *
 * This is a compatibility path for callers that have not resolved a system
 * connection yet. `apiKey` is intentionally left unset so the adapter uses the
 * process default; that is the same application the customer token belongs to.
 */
export function contextFromKiteSession(session: KiteSession): MarketDataContext {
  return {
    provider: "KITE",
    credentials: { accessToken: session.accessToken },
    source: "CUSTOMER_SESSION_COMPAT",
  };
}

export function toMarketDataContext(input: MarketDataInput): MarketDataContext {
  return isMarketDataContext(input) ? input : contextFromKiteSession(input);
}
