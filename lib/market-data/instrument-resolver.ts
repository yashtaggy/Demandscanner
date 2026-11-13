/**
 * Provider-specific instrument-key resolution.
 *
 * instruments.instrument_id is the application's canonical id and is never
 * renumbered. Provider adapters need their own key (a Kite instrument token,
 * an Upstox instrument key). For Kite the canonical id IS the instrument token,
 * so resolution is local. Other providers resolve through instrument_aliases.
 */

import { getDb } from "@/lib/db";
import type { MarketDataProviderName } from "./types";

export async function resolveProviderInstrumentKey(
  provider: MarketDataProviderName,
  instrumentId: number
): Promise<string> {
  if (provider === "KITE") return String(instrumentId);

  const sql = getDb();
  const rows = await sql`
    SELECT provider_instrument_key
      FROM instrument_aliases
     WHERE instrument_id = ${instrumentId} AND provider = ${provider}
     LIMIT 1
  `;
  if (rows.length === 0) {
    throw new Error(
      `No ${provider} instrument alias exists for instrument ${instrumentId}.`
    );
  }
  return String((rows[0] as Record<string, unknown>).provider_instrument_key);
}

export interface InstrumentAliasInput {
  instrumentId: number;
  provider: MarketDataProviderName;
  providerInstrumentKey: string;
  exchange: string;
  tradingSymbol: string;
  instrumentType?: string | null;
  segment?: string | null;
}

/** Add or refresh one alias. Never changes the canonical instrument id. */
export async function upsertInstrumentAlias(
  input: InstrumentAliasInput
): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO instrument_aliases
      (instrument_id, provider, provider_instrument_key, exchange,
       trading_symbol, instrument_type, segment)
    VALUES
      (${input.instrumentId}, ${input.provider}, ${input.providerInstrumentKey},
       ${input.exchange}, ${input.tradingSymbol}, ${input.instrumentType ?? null},
       ${input.segment ?? null})
    ON CONFLICT (provider, provider_instrument_key) DO UPDATE SET
      instrument_id = EXCLUDED.instrument_id,
      exchange = EXCLUDED.exchange,
      trading_symbol = EXCLUDED.trading_symbol,
      instrument_type = EXCLUDED.instrument_type,
      segment = EXCLUDED.segment,
      updated_at = NOW()
  `;
}
