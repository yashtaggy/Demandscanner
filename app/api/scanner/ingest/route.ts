import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/kite-session';
import { requireActiveSubscription } from '@/lib/subscriptions/entitlements';
import { authErrorResponse } from '@/lib/auth/http';
import { getOrCreateDefaultConfig } from '@/lib/scanner/config';
import { createScanJob, updateScanJob } from '@/lib/scanner/jobs';
import { syncInstruments } from '@/lib/scanner/instruments';
import { ingestAllInstruments } from '@/lib/scanner/ingest_all';
import { ingestAllHourlyCandles } from '@/lib/scanner/hourly_ingest';
import {
  markMarketDataContextUsed,
  resolveMarketDataContext,
} from '@/lib/market-data/credentials';
import { MarketDataUnavailableError } from '@/lib/market-data/errors';
import {
  DEFAULT_INGESTION_LEASE_MS,
  acquireGlobalIngestionLock,
  releaseGlobalIngestionLock,
  renewGlobalIngestionLock,
} from '@/lib/market-data/lock';

/**
 * POST /api/scanner/ingest
 *
 * Instruments sync + incremental candle ingestion (daily + 1H).
 * Idempotent — per-instrument checkpoints skip already-fetched ranges.
 *
 * Market data comes from the system connection, never from the requesting
 * customer's Kite token (the customer-session compatibility path may apply
 * only where policy allows it). A PostgreSQL global lease guarantees that at
 * most one ingestion calls the provider at a time.
 *
 * Body (optional JSON):
 *   {
 *     from: "2023-01-01",   -- defaults to 1 year back
 *     to:   "2024-10-18",   -- defaults to today
 *     concurrency: 5,       -- parallel Kite requests for daily
 *     includeHourly: true   -- also ingest 1H candles (default true)
 *   }
 *
 * Returns: { jobId: string }
 * Poll /api/scanner/job/:jobId for status.
 */
export async function POST(req: NextRequest) {
  const cookie = req.headers.get('cookie');
  let user;
  try {
    user = (await requireActiveSubscription(cookie)).user;
  } catch (err) {
    return authErrorResponse(err);
  }

  // Optional staging-only fallback; the system connection is preferred.
  const session = await getSessionFromRequest(cookie);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* use defaults */ }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  const fromDate = body.from ? new Date(body.from as string) : defaultFrom;
  const toDate   = body.to   ? new Date(body.to   as string) : now;

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json(
      { error: 'Invalid date format. Use ISO 8601 (YYYY-MM-DD).' },
      { status: 400 }
    );
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: '`from` must be before `to`.' }, { status: 400 });
  }

  const concurrency     = Number(body.concurrency)  || 5;
  const includeHourly   = body.includeHourly !== false; // default true

  let marketData;
  try {
    marketData = await resolveMarketDataContext({ provider: 'KITE', session });
  } catch (err) {
    if (err instanceof MarketDataUnavailableError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    throw err;
  }

  const lock = await acquireGlobalIngestionLock();
  if (!lock) {
    return NextResponse.json(
      {
        error: 'A market-data ingestion is already in progress. Retry shortly.',
        code: 'INGESTION_IN_PROGRESS',
        retryAfterMs: 15_000,
      },
      { status: 409 }
    );
  }

  let jobId: string;
  try {
    const configId = await getOrCreateDefaultConfig();
    jobId = await createScanJob(configId, { initiatorUserId: user.userId });
  } catch (err) {
    await releaseGlobalIngestionLock(lock);
    throw err;
  }

  const heartbeat = setInterval(() => {
    void renewGlobalIngestionLock(lock, DEFAULT_INGESTION_LEASE_MS)
      .then((held) => {
        if (!held) {
          console.warn(`[scanner/ingest] lost global lease for job ${jobId}; another ingestion may run`);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
        console.warn(`[scanner/ingest] lease heartbeat failed: ${message}`);
      });
  }, 40_000);
  heartbeat.unref?.();

  (async () => {
    try {
      await updateScanJob(jobId, { status: 'RUNNING', progressPercent: 2 });

      // Step 1 — Sync instrument master
      await syncInstruments(marketData);
      await updateScanJob(jobId, { progressPercent: 10 });

      // Step 2a — Ingest daily candles
      await ingestAllInstruments(marketData, fromDate, toDate, concurrency);
      await updateScanJob(jobId, { progressPercent: includeHourly ? 55 : 95 });

      // Step 2b — Ingest 1H hourly candles (rate-limit sensitive: concurrency ≤ 3)
      if (includeHourly) {
        await ingestAllHourlyCandles(marketData, fromDate, toDate, Math.min(concurrency, 3));
        await updateScanJob(jobId, { progressPercent: 95 });
      }

      await markMarketDataContextUsed(marketData);
      await updateScanJob(jobId, { status: 'SUCCESS', progressPercent: 100, completedAt: new Date() });
    } catch (err) {
      console.error('[scanner/ingest] job failed:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      await updateScanJob(jobId, { status: 'FAILED', errorMessage: message, completedAt: new Date() });
    } finally {
      clearInterval(heartbeat);
      try {
        await releaseGlobalIngestionLock(lock);
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
        console.warn(`[scanner/ingest] failed to release global lease: ${message}`);
      }
    }
  })();

  return NextResponse.json({ jobId });
}
