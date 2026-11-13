import { getDb } from "../db";
import { toMarketDataContext, type MarketDataInput } from "@/lib/market-data/context";
import { getMarketDataProvider } from "@/lib/market-data/provider";
import type { ProviderInstrument } from "@/lib/market-data/types";
import { bulkUpsert } from "./bulk";
import { seedNifty500Membership, type MembershipSeedResult } from "./universe";

/**
 * Extract NSE equity rows from a provider instrument master.
 * Deduplicated by provider instrument key (the master can contain repeats).
 */
function nseEquityRows(
  rawInstruments: ProviderInstrument[],
  source: string
): Array<[number, string, string, string | null, boolean, string, Date]> {
  const byToken = new Map<number, [number, string, string, string | null, boolean, string, Date]>();
  const now = new Date();

  for (const raw of rawInstruments) {
    if (raw.segment !== "NSE" && raw.segment !== "NSE-EQ") continue;
    if (raw.instrumentType !== "EQ") continue;
    const token = Number(raw.providerInstrumentKey);
    if (!Number.isFinite(token)) continue;
    byToken.set(token, [
      token,
      raw.tradingSymbol,
      raw.exchange,
      raw.companyName,
      true,
      source,
      now,
    ]);
  }

  return [...byToken.values()];
}

async function upsertInstrumentRows(
  rows: Array<[number, string, string, string | null, boolean, string, Date]>
): Promise<number> {
  return bulkUpsert({
    table: "instruments",
    columns: [
      "instrument_id",
      "symbol",
      "exchange",
      "company_name",
      "active",
      "source",
      "updated_at",
    ],
    rows,
    conflictClause: `ON CONFLICT (instrument_id) DO UPDATE SET
      symbol       = EXCLUDED.symbol,
      exchange     = EXCLUDED.exchange,
      company_name = EXCLUDED.company_name,
      active       = EXCLUDED.active,
      source       = EXCLUDED.source,
      updated_at   = EXCLUDED.updated_at`,
  });
}

export interface InstrumentSyncResult {
  /** Instrument rows upserted from the Kite master. */
  upserted: number;
  /** Rows added to nifty500_membership by this sync (0 if already seeded). */
  membershipSeeded: number;
  universe: MembershipSeedResult;
}

/**
 * Download the NSE instrument master ONCE, upsert all NSE EQ rows, and seed
 * the Nifty 500 membership table from the curated constituent list.
 *
 * One download per sync stage — the previous chunked implementation
 * re-downloaded the full master for every 120 instruments.
 */
export async function syncInstrumentMaster(
  input: MarketDataInput
): Promise<InstrumentSyncResult> {
  const context = toMarketDataContext(input);
  const provider = getMarketDataProvider(context.provider);
  const rawInstruments = await provider.listInstruments(
    context.credentials,
    "NSE"
  );

  const rows = nseEquityRows(rawInstruments, context.provider.toLowerCase());
  const upserted = await upsertInstrumentRows(rows);
  const universe = await seedNifty500Membership();

  console.info(
    `[scanner] instrument sync: nseEquity=${upserted} curated=${universe.curated} ` +
      `matched=${universe.matched} membershipSeeded=${universe.seeded} ` +
      `membershipClosed=${universe.removed} placeholdersExcluded=${universe.excludedPlaceholders.length}`
  );

  return { upserted, membershipSeeded: universe.seeded, universe };
}

/** Full instrument sync (kept for local/long-running callers). */
export async function syncNseInstruments(input: MarketDataInput): Promise<number> {
  return (await syncInstrumentMaster(input)).upserted;
}

export async function listActiveInstrumentIds(limitToIds?: number[]): Promise<number[]> {
  const sql = getDb();
  let rows;
  if (limitToIds && limitToIds.length > 0) {
    rows = await sql`
      SELECT instrument_id FROM instruments
      WHERE active = true AND instrument_id = ANY(${limitToIds}::bigint[])
      ORDER BY instrument_id
    `;
  } else {
    rows = await sql`
      SELECT instrument_id FROM instruments WHERE active = true ORDER BY instrument_id
    `;
  }
  return rows.map((r: Record<string, unknown>) => Number(r.instrument_id));
}

export async function resolveInstrumentIdsBySymbol(symbols: string[]): Promise<number[]> {
  if (symbols.length === 0) return [];
  const sql = getDb();
  const rows = await sql`
    SELECT instrument_id FROM instruments
    WHERE active = true AND symbol = ANY(${symbols}::text[])
    ORDER BY instrument_id
  `;
  return rows.map((r: Record<string, unknown>) => Number(r.instrument_id));
}

/** Alias for backward compatibility with orchestrator imports. */
export const syncInstruments = syncNseInstruments;
