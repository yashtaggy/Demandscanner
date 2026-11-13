import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionIdFromCookies } from '@/lib/kite-session';
import { hashSessionId } from '@/lib/crypto';
import { requireActiveSubscription } from '@/lib/subscriptions/entitlements';
import { authErrorResponse } from '@/lib/auth/http';
import { getScanBatchStats, getScanJob } from '@/lib/scanner/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/scanner/job/[jobId]
 * Returns the scan job record (status, progress, errors, timestamps).
 */
export async function GET(req: NextRequest) {
  // Ensure request is authenticated.
  let user;
  try {
    user = (await requireActiveSubscription(req.headers.get('cookie'))).user;
  } catch (err) {
    return authErrorResponse(err);
  }

  // Extract jobId from the URL pathname.
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // Expected parts: ['api','scanner','job','<jobId>']
  const jobId = parts[3];
  if (!jobId) {
    return NextResponse.json({ error: 'Job ID missing', code: 'MISSING_JOB_ID' }, { status: 400 });
  }

  const job = await getScanJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 });
  }

  // New jobs are owned by the internal app user. Jobs created before Phase 2
  // have no initiator and are only exposed to the matching legacy Kite session.
  if (job.initiator_user_id) {
    if (job.initiator_user_id !== user.userId) {
      return NextResponse.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 });
    }
  } else {
    const sessionId = getSessionIdFromCookies(req.headers.get('cookie'));
    const sessionIdHash = sessionId ? hashSessionId(sessionId) : null;
    // A legacy job is visible only to the exact Kite session that created it.
    // Missing either hash fails closed; such a job could not be resumed anyway.
    if (!job.session_id_hash || !sessionIdHash || job.session_id_hash !== sessionIdHash) {
      return NextResponse.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 });
    }
  }

  return NextResponse.json({ job, batches: await getScanBatchStats(jobId) });
}
