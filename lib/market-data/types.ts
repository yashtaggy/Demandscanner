/**
 * Broker-independent market-data types.
 *
 * Application services (scanner ingestion, aggregation, quotes) consume these
 * normalized structures. No Kite SDK object crosses this boundary.
 */

import type { QuoteData } from "@/lib/types";

export type MarketDataProviderName = "KITE" | "UPSTOX";

/** Where a resolved credential came from. Never persisted as ownership. */
export type MarketDataSource = "SYSTEM" | "CUSTOMER_SESSION_COMPAT";

export type ProviderHistoricalTimeframe = "1D" | "1H";

/**
 * Credentials handed to a provider adapter.
 *
 * `apiKey` is a provider application identifier (public), not a secret. It is
 * required when a token was issued for a different provider application than
 * the process-wide default, as with the system Kite connection.
 */
export interface MarketDataCredentials {
  accessToken: string;
  apiKey?: string;
  refreshToken?: string;
}

/** A normalized historical candle. Timestamps are absolute instants. */
export interface ProviderHistoricalCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** One instrument in a provider's instrument master, normalized. */
export interface ProviderInstrument {
  providerInstrumentKey: string;
  exchange: string;
  tradingSymbol: string;
  companyName: string | null;
  instrumentType: string | null;
  segment: string | null;
}

/**
 * The resolved market-data context every service operates on.
 *
 * `source` records provenance for logging and authorization decisions. A
 * CUSTOMER_SESSION_COMPAT context is a temporary compatibility path and is
 * never written to market_data_connections.
 */
export interface MarketDataContext {
  provider: MarketDataProviderName;
  credentials: MarketDataCredentials;
  source: MarketDataSource;
  connectionId?: string;
}

/**
 * The provider seam. Implementations translate their SDK's raw responses into
 * these normalized structures and rethrow provider errors unchanged so the
 * existing retry classification keeps working.
 */
export interface MarketDataProvider {
  readonly name: MarketDataProviderName;
  listInstruments(
    credentials: MarketDataCredentials,
    exchange: string
  ): Promise<ProviderInstrument[]>;
  getQuotes(
    credentials: MarketDataCredentials,
    symbols: string[]
  ): Promise<Map<string, QuoteData>>;
  getHistoricalCandles(
    credentials: MarketDataCredentials,
    providerInstrumentKey: string,
    timeframe: ProviderHistoricalTimeframe,
    from: Date,
    to: Date
  ): Promise<ProviderHistoricalCandle[]>;
}
