import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest, getSessionIdFromCookies } from '@/lib/kite-session';
import { hashSessionId } from '@/lib/crypto';
import { requireActiveSubscription } from '@/lib/subscriptions/entitlements';
import { authErrorResponse } from '@/lib/auth/http';
import { getOrCreateDefaultConfig } from '@/lib/scanner/config';
import { createScanJob, findActiveScanJob, getScanBatchStats, getScanJob, retireStaleScanJobs } from '@/lib/scanner/jobs';
import { processScanBatch } from '@/lib/scanner/batchRunner';
import { MarketDataUnavailableError } from '@/lib/market-data/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/scanner/run
 *
 * Returns the authenticated user's active scan job, if any. The browser uses
 * this on mount to resume monitoring (and processing) after a refresh instead
 * of starting a duplicate scan.
 */
export async function GET(req: NextRequest) {
  const cookie = req.headers.get('cookie');
  let user;
  try {
    user = (await requireActiveSubscription(cookie)).user;
  } catch (err) {
    return authErrorResponse(err);
  }

  // Best-effort Kite context: only used to adopt in-flight jobs created before
  // Phase 2. App access never depends on a Kite session.
  const sessionId = getSessionIdFromCookies(cookie);
  const sessionIdHash = sessionId ? hashSessionId(sessionId) : null;

  // Retire abandoned jobs first so an old, unreachable scan cannot be resumed
  // automatically after deployment.
  await retireStaleScanJobs({ userId: user.userId, sessionIdHash });

  const active = await findActiveScanJob({ userId: user.userId, sessionIdHash });
  if (!active) {
    return NextResponse.json({ jobId: null, moreRemaining: false, job: null });
  }

  const job = await getScanJob(active.job_id);
  return NextResponse.json({
    jobId: active.job_id,
    moreRemaining: true,
    job,
    batches: await getScanBatchStats(active.job_id),
  });
}

/**
 * POST /api/scanner/run
 *
 * Queues a resumable scan and immediately processes the first bounded batch.
 * Remaining work is continued by the browser via POST /api/scanner/batch,
 * which keeps requesting bounded batches until the job reaches a terminal
 * state (SUCCESS or FAILED). Progress pauses if the browser is closed.
 *
 * Body (optional JSON):
 *  {
 *    "from": "2023-01-01",
 *    "to": "2024-10-01",
 *    "concurrency": 5,
 *    "symbols": ["RELIANCE"],
 *    "instrumentIds": [408065]
 *  }
 */
export async function POST(req: NextRequest) {
  const cookie = req.headers.get('cookie');
  let user;
  try {
    user = (await requireActiveSubscription(cookie)).user;
  } catch (err) {
    return authErrorResponse(err);
  }

  const sessionId = getSessionIdFromCookies(cookie);
  const sessionIdHash = sessionId ? hashSessionId(sessionId) : null;
  // Optional customer-session fallback for staging only; system market data is
  // preferred and no customer Kite login is required when it is configured.
  const session = await getSessionFromRequest(cookie);

  await retireStaleScanJobs({ userId: user.userId, sessionIdHash });

  const active = await findActiveScanJob({ userId: user.userId, sessionIdHash });
  if (active) {
    return NextResponse.json(
      {
        error: 'SCAN_IN_PROGRESS',
        jobId: active.job_id,
        message: 'An active scan is already running. Resume it instead of starting another.',
      },
      { status: 409 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // defaults
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  const fromDate = body.from ? new Date(body.from as string) : defaultFrom;
  const toDate = body.to ? new Date(body.to as string) : now;

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json(
      { error: 'Invalid date format', code: 'INVALID_DATES' },
      { status: 400 }
    );
  }
  if (fromDate > toDate) {
    return NextResponse.json(
      { error: '`from` must be before `to`', code: 'INVALID_RANGE' },
      { status: 400 }
    );
  }

  const concurrency = Number(body.concurrency) || 5;
  const instrumentIds = Array.isArray(body.instrumentIds)
    ? body.instrumentIds.map(Number).filter((n: number) => Number.isFinite(n))
    : undefined;
  let symbols: string[] | undefined;
  if (Array.isArray(body.symbols)) {
    const normalized = (body.symbols as unknown[])
      .map((s): string => String(s).trim().toUpperCase())
      .filter((s) => s.length > 0);
    symbols = [...new Set(normalized)];
  }

  const configId = await getOrCreateDefaultConfig();
  const jobId = await createScanJob(configId, {
    initiatorUserId: user.userId,
    fromDate,
    toDate,
    concurrency,
    instrumentIds: instrumentIds && instrumentIds.length > 0 ? instrumentIds : undefined,
    requestedSymbols: symbols && symbols.length > 0 ? symbols : undefined,
  });

  let batch;
  try {
    batch = await processScanBatch({
      jobId,
      userId: user.userId,
      sessionIdHash,
      session,
    });
  } catch (err) {
    if (err instanceof MarketDataUnavailableError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    throw err;
  }

  const job = await getScanJob(jobId);
  return NextResponse.json({
    jobId,
    moreRemaining: batch.moreRemaining,
    durationMs: batch.durationMs,
    job,
  });
}
