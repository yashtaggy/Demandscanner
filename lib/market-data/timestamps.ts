/**
 * Provider timestamp normalization.
 *
 * Kite's SDK converts zone-less IST wall clocks to a `Date` interpreted in the
 * runtime's local timezone. `normalizeKiteTimestamp` recovers the true instant.
 * Future providers add their own case here; services always receive either an
 * ISO-8601 UTC string or null.
 */

import { normalizeKiteTimestamp } from "@/lib/kite-timestamp";
import type { MarketDataProviderName } from "./types";

export function normalizeProviderTimestamp(
  provider: MarketDataProviderName,
  value: unknown
): string | null {
  switch (provider) {
    case "KITE":
      return normalizeKiteTimestamp(value);
    default:
      return null;
  }
}
