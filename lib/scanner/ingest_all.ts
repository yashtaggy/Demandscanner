import { getDb } from "../db";
import { type MarketDataInput } from "@/lib/market-data/context";
import { ingestDailyCandles } from "./candle_ingest";
import { isPermanentError, sanitizeErrorMessage } from "./retry";

/**
 * Simple concurrency limiter – runs `fn` on items with at most `limit` parallel
 * executions. Uses a self-managing pool without relying on Promise internals.
 */
async function parallelLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const pool = new Set<Promise<void>>();
  for (const item of items) {
    const p: Promise<void> = fn(item).finally(() => pool.delete(p));
    pool.add(p);
    if (pool.size >= limit) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);
}

/**
 * Ingest daily candles for **all active instruments** between `fromDate` and
 * `toDate`. This is the entry point used by the scanner job API.
 *
 * It respects a configurable concurrency limit (default 5) to avoid hitting
 * Kite's per‑second rate limits. Each instrument is processed via
 * `ingestDailyCandles`, which already implements checkpointing and exponential
 * back‑off.
 *
 * @param input        Market-data context (or a Kite session on the compat path).
 * @param fromDate     Inclusive start date for ingestion.
 * @param toDate       Inclusive end date for ingestion.
 * @param concurrency  Maximum parallel Kite requests (default 5).
 * @returns total number of newly inserted candles across all instruments.
 */
export async function ingestAllInstruments(
  input: MarketDataInput,
  fromDate: Date,
  toDate: Date,
  concurrency = 5
): Promise<number> {
  const sql = getDb();
  const rows = await sql`
    SELECT instrument_id FROM instruments WHERE active = true ORDER BY instrument_id
  `;
  const instrumentIds: number[] = rows.map((r: Record<string, unknown>) =>
    Number(r.instrument_id)
  );

  let totalInserted = 0;
  const failures: Array<{ instrumentId: number; message: string }> = [];
  let permanentFailure: unknown = null;

  await parallelLimit(instrumentIds, concurrency, async (instrumentId) => {
    if (permanentFailure) return;
    try {
      const inserted = await ingestDailyCandles(input, instrumentId, fromDate, toDate);
      totalInserted += inserted;
    } catch (err) {
      failures.push({ instrumentId, message: sanitizeErrorMessage(err) });
      if (isPermanentError(err) && permanentFailure == null) permanentFailure = err;
    }
  });

  // Do not let a partial run look successful: the old per-instrument catch
  // swallowed every error and returned normally.
  if (permanentFailure) throw permanentFailure;
  if (failures.length > 0) {
    const sample = failures
      .slice(0, 5)
      .map((f) => `${f.instrumentId}: ${f.message}`)
      .join('; ');
    throw new Error(
      `${failures.length}/${instrumentIds.length} instrument(s) failed daily ingestion: ${sample}`
    );
  }

  return totalInserted;
}
