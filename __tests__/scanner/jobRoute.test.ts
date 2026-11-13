/**
 * Scan job read authorization.
 *
 * New jobs belong to an internal app_users.user_id. Legacy jobs (no internal
 * owner) are visible only to the exact Kite session hash that created them.
 * A legacy hash must never grant access to an internally owned job.
 */

jest.mock('@/lib/subscriptions/entitlements', () => ({
  requireActiveSubscription: jest.fn(),
}));

jest.mock('@/lib/scanner/jobs', () => ({
  getScanJob: jest.fn(),
  getScanBatchStats: jest.fn(async () => []),
}));

jest.mock('@/lib/kite-session', () => ({
  getSessionIdFromCookies: jest.fn(),
}));

jest.mock('@/lib/crypto', () => ({
  hashSessionId: jest.fn((value: string) => `hash:${value}`),
}));

import { NextRequest } from 'next/server';
import { requireActiveSubscription } from '@/lib/subscriptions/entitlements';
import { getScanJob } from '@/lib/scanner/jobs';
import { getSessionIdFromCookies } from '@/lib/kite-session';
import { AppAuthError } from '@/lib/auth/types';
import { GET as jobRoute } from '@/app/api/scanner/job/[jobId]/route';

const user = {
  userId: 'user-1',
  email: 'user@example.com',
  displayName: null,
  status: 'ACTIVE' as const,
  role: 'CUSTOMER' as const,
};

function request() {
  return new NextRequest(new URL('/api/scanner/job/job-1', 'https://app.test'), {
    method: 'GET',
    headers: { cookie: 'ds_app_session=session-cookie' },
  });
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: 'job-1',
    status: 'RUNNING',
    initiator_user_id: null,
    session_id_hash: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireActiveSubscription as jest.Mock).mockResolvedValue({ user, subscription: { entitled: true, today: '2026-11-13', current: null, history: [] } });
  (getSessionIdFromCookies as jest.Mock).mockReturnValue(null);
  (getScanJob as jest.Mock).mockResolvedValue(job());
});

describe('GET /api/scanner/job/[jobId]', () => {
  test('requires an authenticated app user', async () => {
    (requireActiveSubscription as jest.Mock).mockRejectedValue(
      new AppAuthError('UNAUTHENTICATED')
    );

    const res = await jobRoute(request());

    expect(res.status).toBe(401);
    expect(getScanJob).not.toHaveBeenCalled();
  });

  test('returns a job owned by the requesting internal user', async () => {
    (getScanJob as jest.Mock).mockResolvedValue(job({ initiator_user_id: 'user-1' }));

    const res = await jobRoute(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ job: { job_id: 'job-1' } });
  });

  test('hides another customer job behind 404', async () => {
    (getScanJob as jest.Mock).mockResolvedValue(job({ initiator_user_id: 'user-2' }));

    const res = await jobRoute(request());

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('JOB_NOT_FOUND');
  });

  test('does not let a matching legacy hash claim an internally owned job', async () => {
    (getScanJob as jest.Mock).mockResolvedValue(
      job({ initiator_user_id: 'user-1', session_id_hash: 'hash:sid' })
    );
    (requireActiveSubscription as jest.Mock).mockResolvedValue({ user: { ...user, userId: 'user-2' }, subscription: { entitled: true, today: '2026-11-13', current: null, history: [] } });
    (getSessionIdFromCookies as jest.Mock).mockReturnValue('sid');

    const res = await jobRoute(request());

    expect(res.status).toBe(404);
  });

  test('returns a legacy job only to the matching Kite session hash', async () => {
    (getScanJob as jest.Mock).mockResolvedValue(
      job({ initiator_user_id: null, session_id_hash: 'hash:sid' })
    );
    (getSessionIdFromCookies as jest.Mock).mockReturnValue('sid');

    const res = await jobRoute(request());

    expect(res.status).toBe(200);
  });

  test('rejects a legacy job with a different session hash', async () => {
    (getScanJob as jest.Mock).mockResolvedValue(
      job({ initiator_user_id: null, session_id_hash: 'hash:other' })
    );
    (getSessionIdFromCookies as jest.Mock).mockReturnValue('sid');

    const res = await jobRoute(request());

    expect(res.status).toBe(404);
  });

  test('fails closed for a legacy job with no hash or no Kite session', async () => {
    (getScanJob as jest.Mock).mockResolvedValue(
      job({ initiator_user_id: null, session_id_hash: null })
    );
    let res = await jobRoute(request());
    expect(res.status).toBe(404);

    (getScanJob as jest.Mock).mockResolvedValue(
      job({ initiator_user_id: null, session_id_hash: 'hash:sid' })
    );
    (getSessionIdFromCookies as jest.Mock).mockReturnValue(null);
    res = await jobRoute(request());
    expect(res.status).toBe(404);
  });
});
