import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest, getSessionIdFromCookies } from '@/lib/kite-session';
import { hashSessionId } from '@/lib/crypto';
import { requireActiveSubscription } from '@/lib/subscriptions/entitlements';
import { authErrorResponse } from '@/lib/auth/http';
import { processScanBatch } from '@/lib/scanner/batchRunner';
import { getScanBatchStats, getScanJob } from '@/lib/scanner/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Process one bounded scan batch for the authenticated user's active job.
 *
 * POST — authenticated UI worker (`ds_sid` session cookie). Optional `{ jobId }`.
 * The browser keeps requesting batches until the job reaches a terminal state
 * (SUCCESS or FAILED).
 */
export async function POST(req: NextRequest) {
  const cookie = req.headers.get('cookie');
  let user;
  try {
    user = (await requireActiveSubscription(cookie)).user;
  } catch (err) {
    return authErrorResponse(err);
  }

  // Legacy Kite context is optional: it can adopt a pre-Phase-2 job and feed the
  // staging-only customer-session market-data fallback. It is never required.
  const sessionId = getSessionIdFromCookies(cookie);
  const sessionIdHash = sessionId ? hashSessionId(sessionId) : null;
  const session = await getSessionFromRequest(cookie);

  let jobId: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.jobId === 'string' && body.jobId.trim()) {
      jobId = body.jobId.trim();
    }
  } catch {
    // empty body is fine
  }

  const result = await processScanBatch({
    jobId,
    userId: user.userId,
    sessionIdHash,
    session,
  });

  // Avoid a re-read: the persist step returns the updated row.
  const job = result.job ?? (result.jobId ? await getScanJob(result.jobId) : null);

  return NextResponse.json({
    claimed: result.claimed,
    jobId: result.jobId,
    moreRemaining: result.moreRemaining,
    processedInBatch: result.processedInBatch,
    durationMs: result.durationMs,
    errorMessage: result.errorMessage,
    retryAfterMs: result.retryAfterMs,
    job,
    batches: result.jobId ? await getScanBatchStats(result.jobId) : null,
  });
}
