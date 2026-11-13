/**
 * Provider registry.
 *
 * A plain switch is deliberate: this is a two-provider seam, not a plugin
 * framework. Adding Upstox later means adding one adapter and one case.
 */

import { MarketDataUnavailableError } from "./errors";
import { kiteMarketDataProvider } from "./kite-adapter";
import type { MarketDataProvider, MarketDataProviderName } from "./types";

const PROVIDERS: Partial<Record<MarketDataProviderName, MarketDataProvider>> = {
  KITE: kiteMarketDataProvider,
};

export function getMarketDataProvider(
  provider: MarketDataProviderName
): MarketDataProvider {
  const adapter = PROVIDERS[provider];
  if (!adapter) {
    throw new MarketDataUnavailableError(
      `No market-data adapter is implemented for provider ${provider}.`
    );
  }
  return adapter;
}

export function isMarketDataProviderImplemented(
  provider: MarketDataProviderName
): boolean {
  return Boolean(PROVIDERS[provider]);
}
