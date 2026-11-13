/**
 * Kite Connect market-data adapter.
 *
 * Implements the broker-independent MarketDataProvider seam. It converts raw
 * Kite/SDK shapes into normalized structures and rethrows provider errors
 * unchanged, so the existing transient/permanent retry classifier still
 * applies to historical ingestion.
 */

import type { Exchanges } from "kiteconnect";
import { createKiteClient, getQuotes } from "@/lib/kite-client";
import type { QuoteData } from "@/lib/types";
import type {
  MarketDataCredentials,
  MarketDataProvider,
  ProviderHistoricalCandle,
  ProviderHistoricalTimeframe,
  ProviderInstrument,
} from "./types";

interface RawKiteInstrument {  instrument_token?: string | number;
  exchange?: string;
  tradingsymbol?: string;
  name?: string | null;
  instrument_type?: string | null;
  segment?: string | null;
}

interface RawKiteCandle {
  date: string | Date;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

/** Kite daily windows are sent as UTC calendar dates with fixed session times. */
function formatUtcSessionDate(d: Date, endOfDay: boolean): string {
  const date = d.toISOString().split("T")[0];
  return `${date} ${endOfDay ? "15:30:00" : "09:15:00"}`;
}

/** Kite intraday windows are sent as IST wall clocks without a zone suffix. */
function formatIstSessionDate(d: Date, endOfDay: boolean): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${endOfDay ? "15:30:00" : "09:15:00"}`;
}

function parseInstrumentToken(key: string): number {
  const token = Number(key);
  if (!Number.isFinite(token) || token <= 0) {
    throw new Error(`Kite instrument key is not a numeric instrument token: ${key}`);
  }
  return token;
}

function normalizeCandle(row: RawKiteCandle): ProviderHistoricalCandle {
  // The Kite SDK already returns a Date for the zone-less IST wall clock; the
  // previous ingestion code used the SDK Date directly, and that behaviour is
  // preserved here so candle timestamps do not shift.
  const timestamp = row.date instanceof Date ? row.date : new Date(row.date);
  return {
    timestamp,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

export const kiteMarketDataProvider: MarketDataProvider = {
  name: "KITE",

  async listInstruments(
    credentials: MarketDataCredentials,
    exchange: string
  ): Promise<ProviderInstrument[]> {
    const kc = createKiteClient(credentials.accessToken, credentials.apiKey);
    const raw = (await kc.getInstruments(
      exchange as Exchanges
    )) as unknown as RawKiteInstrument[];

    return raw
      .map((row) => ({
        providerInstrumentKey: String(row.instrument_token ?? ""),
        exchange: String(row.exchange ?? exchange),
        tradingSymbol: String(row.tradingsymbol ?? ""),
        companyName: row.name ?? null,
        instrumentType: row.instrument_type ?? null,
        segment: row.segment ?? null,
      }))
      .filter(
        (row) =>
          row.tradingSymbol !== "" && Number.isFinite(Number(row.providerInstrumentKey))
      );
  },

  async getQuotes(
    credentials: MarketDataCredentials,
    symbols: string[]
  ): Promise<Map<string, QuoteData>> {
    return getQuotes(credentials.accessToken, symbols, credentials.apiKey);
  },

  async getHistoricalCandles(
    credentials: MarketDataCredentials,
    providerInstrumentKey: string,
    timeframe: ProviderHistoricalTimeframe,
    from: Date,
    to: Date
  ): Promise<ProviderHistoricalCandle[]> {
    const token = parseInstrumentToken(providerInstrumentKey);
    const kc = createKiteClient(credentials.accessToken, credentials.apiKey);

    // Kite has no single range API: 1D and 1H use different intervals and
    // different wire date formats. Chunking stays in the ingestion service.
    const interval = timeframe === "1D" ? "day" : "60minute";
    const format = timeframe === "1D" ? formatUtcSessionDate : formatIstSessionDate;

    const raw = (await kc.getHistoricalData(
      token,
      interval,
      format(from, false),
      format(to, true)
    )) as unknown as RawKiteCandle[];

    return raw.map(normalizeCandle);
  },
};
