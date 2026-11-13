/**
 * Auth and admin route boundary tests.
 *
 * These exercise the HTTP surface: same-origin enforcement, safe status codes,
 * one-time reset link delivery, cookie attributes, and super-admin-only role
 * changes. Lower-level rules are covered by session.test.ts.
 */

jest.mock('@/lib/auth/firebase-admin', () => ({
  verifyFirebaseIdToken: jest.fn(),
  createAppSessionCookie: jest.fn(),
  revokeFirebaseSessions: jest.fn(),
}));

jest.mock('@/lib/auth/session', () => ({
  requireAppUser: jest.fn(),
  requireAppUserSession: jest.fn(),
  requireAdmin: jest.fn(),
  requireSuperAdmin: jest.fn(),
  findAppUserByFirebaseUid: jest.fn(),
}));

jest.mock('@/lib/auth/rate-limit', () => ({
  consumeRateLimit: jest.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));

jest.mock('@/lib/auth/provisioning', () => {
  const actual = jest.requireActual('@/lib/auth/provisioning');
  return {
    ...actual,
    provisionCustomer: jest.fn(),
    setUserStatus: jest.fn(),
    setUserRole: jest.fn(),
  };
});

import { NextRequest } from 'next/server';
import {
  createAppSessionCookie,
  revokeFirebaseSessions,
  verifyFirebaseIdToken,
} from '@/lib/auth/firebase-admin';
import {
  findAppUserByFirebaseUid,
  requireAdmin,
  requireAppUser,
  requireAppUserSession,
  requireSuperAdmin,
} from '@/lib/auth/session';
import {
  provisionCustomer,
  setUserRole,
  setUserStatus,
} from '@/lib/auth/provisioning';
import { consumeRateLimit } from '@/lib/auth/rate-limit';
import { AppAuthError } from '@/lib/auth/types';
import {
  DELETE as logoutRoute,
  GET as sessionGetRoute,
  POST as sessionPostRoute,
} from '@/app/api/auth/session/route';
import { POST as logoutAllRoute } from '@/app/api/auth/session/logout-all/route';
import { POST as provisionRoute } from '@/app/api/admin/customers/route';
import { PATCH as statusRoute } from '@/app/api/admin/users/[userId]/status/route';
import { POST as roleRoute } from '@/app/api/admin/users/[userId]/role/route';

const customer = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'customer@example.com',
  displayName: 'Customer',
  status: 'ACTIVE' as const,
  role: 'CUSTOMER' as const,
};

function request(
  path: string,
  init: { method?: string; body?: unknown; origin?: string; cookie?: string | null } = {}
) {
  const headers = new Headers();
  if (init.cookie !== null) {
    headers.set('cookie', init.cookie ?? 'ds_app_session=session-cookie');
  }
  headers.set('origin', init.origin ?? 'https://app.test');
  if (init.body !== undefined) headers.set('content-type', 'application/json');

  return new NextRequest(new URL(path, 'https://app.test'), {
    method: init.method ?? 'POST',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json();
}

function params(userId = customer.userId) {
  return { params: Promise.resolve({ userId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (consumeRateLimit as jest.Mock).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  (requireAppUser as jest.Mock).mockResolvedValue(customer);
  (requireAppUserSession as jest.Mock).mockResolvedValue({
    user: customer,
    firebaseUid: 'firebase-uid-1',
  });
  (requireAdmin as jest.Mock).mockResolvedValue({ ...customer, role: 'ADMIN' });
  (requireSuperAdmin as jest.Mock).mockResolvedValue({
    ...customer,
    role: 'SUPER_ADMIN',
  });
  (revokeFirebaseSessions as jest.Mock).mockResolvedValue(undefined);
});

describe('POST /api/auth/session', () => {
  const validToken = 'x'.repeat(200);

  test('rejects a cross-site origin before verifying anything', async () => {
    const res = await sessionPostRoute(
      request('/api/auth/session', {
        body: { idToken: validToken },
        origin: 'https://evil.example',
      })
    );

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('INVALID_ORIGIN');
    expect(verifyFirebaseIdToken).not.toHaveBeenCalled();
  });

  test('rejects a missing or malformed body', async () => {
    const res = await sessionPostRoute(
      request('/api/auth/session', { body: { idToken: 'short' } })
    );
    expect(res.status).toBe(400);
    expect(verifyFirebaseIdToken).not.toHaveBeenCalled();
  });

  test('rejects an unverifiable Firebase ID token', async () => {
    (verifyFirebaseIdToken as jest.Mock).mockRejectedValue(new Error('bad token'));
    const res = await sessionPostRoute(
      request('/api/auth/session', { body: { idToken: validToken } })
    );
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe('INVALID_TOKEN');
  });

  test('rejects an authenticated Firebase user with no app mapping', async () => {
    (verifyFirebaseIdToken as jest.Mock).mockResolvedValue({ uid: 'uid-1' });
    (findAppUserByFirebaseUid as jest.Mock).mockRejectedValue(
      new AppAuthError('NO_IDENTITY')
    );

    const res = await sessionPostRoute(
      request('/api/auth/session', { body: { idToken: validToken } })
    );
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('ACCESS_DENIED');
  });

  test('rejects a suspended app user', async () => {
    (verifyFirebaseIdToken as jest.Mock).mockResolvedValue({ uid: 'uid-1' });
    (findAppUserByFirebaseUid as jest.Mock).mockResolvedValue({
      ...customer,
      status: 'SUSPENDED',
    });

    const res = await sessionPostRoute(
      request('/api/auth/session', { body: { idToken: validToken } })
    );
    expect(res.status).toBe(403);
    expect(createAppSessionCookie).not.toHaveBeenCalled();
  });

  test('creates an HttpOnly SameSite=Lax session cookie for an active user', async () => {
    (verifyFirebaseIdToken as jest.Mock).mockResolvedValue({ uid: 'uid-1' });
    (findAppUserByFirebaseUid as jest.Mock).mockResolvedValue(customer);
    (createAppSessionCookie as jest.Mock).mockResolvedValue('firebase-session-cookie');

    const res = await sessionPostRoute(
      request('/api/auth/session', { body: { idToken: validToken } })
    );

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      authenticated: true,
      user: { userId: customer.userId, role: 'CUSTOMER' },
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('ds_app_session=firebase-session-cookie');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie).toContain('Path=/');
  });

  test('returns the current user for GET and 401 without a session', async () => {
    const ok = await sessionGetRoute(request('/api/auth/session', { method: 'GET' }));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ authenticated: true });

    (requireAppUser as jest.Mock).mockRejectedValue(new AppAuthError('UNAUTHENTICATED'));
    const denied = await sessionGetRoute(request('/api/auth/session', { method: 'GET' }));
    expect(denied.status).toBe(401);
  });

  test('normal DELETE clears only this browser cookie and does not revoke Firebase sessions', async () => {
    const res = await logoutRoute(request('/api/auth/session', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
    expect(revokeFirebaseSessions).not.toHaveBeenCalled();
    expect(requireAppUserSession).not.toHaveBeenCalled();
  });
});

describe('logout all devices', () => {
  test('revokes Firebase refresh tokens and clears the current cookie', async () => {
    const res = await logoutAllRoute(
      request('/api/auth/session/logout-all', { method: 'POST' })
    );

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(revokeFirebaseSessions).toHaveBeenCalledWith('firebase-uid-1');
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  test('rejects a cross-site origin before authentication', async () => {
    const res = await logoutAllRoute(
      request('/api/auth/session/logout-all', {
        method: 'POST',
        origin: 'https://evil.example',
      })
    );

    expect(res.status).toBe(403);
    expect(requireAppUserSession).not.toHaveBeenCalled();
    expect(revokeFirebaseSessions).not.toHaveBeenCalled();
  });

  test('requires an active app session', async () => {
    (requireAppUserSession as jest.Mock).mockRejectedValue(
      new AppAuthError('INVALID_SESSION')
    );

    const res = await logoutAllRoute(
      request('/api/auth/session/logout-all', { method: 'POST' })
    );

    expect(res.status).toBe(401);
    expect(revokeFirebaseSessions).not.toHaveBeenCalled();
  });

  test('keeps the current cookie when revocation fails', async () => {
    (revokeFirebaseSessions as jest.Mock).mockRejectedValue(
      Object.assign(new Error('firebase unavailable'), { code: 'auth/internal-error' })
    );

    const res = await logoutAllRoute(
      request('/api/auth/session/logout-all', { method: 'POST' })
    );

    expect(res.status).toBe(502);
    expect((await json(res)).code).toBe('LOGOUT_ALL_FAILED');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('rate limiter failures fail closed', () => {
  const validToken = 'x'.repeat(200);

  test('session creation returns 503 instead of allowing an unthrottled attempt', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });

    const res = await sessionPostRoute(
      request('/api/auth/session', { body: { idToken: validToken } })
    );

    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(verifyFirebaseIdToken).not.toHaveBeenCalled();
  });

  test('session creation still returns 429 when the limit is exceeded', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
    });

    const res = await sessionPostRoute(
      request('/api/auth/session', { body: { idToken: validToken } })
    );

    expect(res.status).toBe(429);
    expect((await json(res)).code).toBe('RATE_LIMITED');
  });

  test('customer provisioning is refused while the limiter is unavailable', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });

    const res = await provisionRoute(
      request('/api/admin/customers', { body: { email: 'new@example.com' } })
    );

    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(provisionCustomer).not.toHaveBeenCalled();
  });

  test('administrative status changes are refused while the limiter is unavailable', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });

    const res = await statusRoute(
      request(`/api/admin/users/${customer.userId}/status`, {
        method: 'PATCH',
        body: { status: 'SUSPENDED' },
      }),
      params()
    );

    expect(res.status).toBe(503);
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  test('role changes are refused while the limiter is unavailable', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });

    const res = await roleRoute(
      request(`/api/admin/users/${customer.userId}/role`, { body: { role: 'ADMIN' } }),
      params()
    );

    expect(res.status).toBe(503);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  test('logout-all is refused while the limiter is unavailable', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });

    const res = await logoutAllRoute(
      request('/api/auth/session/logout-all', { method: 'POST' })
    );

    expect(res.status).toBe(503);
    expect(revokeFirebaseSessions).not.toHaveBeenCalled();
  });
});

describe('admin authorization', () => {
  test('a customer is denied provisioning', async () => {
    (requireAdmin as jest.Mock).mockRejectedValue(new AppAuthError('FORBIDDEN'));

    const res = await provisionRoute(
      request('/api/admin/customers', { body: { email: 'new@example.com' } })
    );
    expect(res.status).toBe(403);
    expect(provisionCustomer).not.toHaveBeenCalled();
  });

  test('an admin receives the one-time reset link exactly once in the response', async () => {
    (provisionCustomer as jest.Mock).mockResolvedValue({
      user: { ...customer, userId: 'new-user', email: 'new@example.com' },
      resetLink: 'https://reset.example/one-time',
    });

    const res = await provisionRoute(
      request('/api/admin/customers', {
        body: { email: 'new@example.com', displayName: 'New' },
      })
    );

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      ok: true,
      resetLink: 'https://reset.example/one-time',
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('an admin cannot promote users because role changes are super-admin only', async () => {
    (requireSuperAdmin as jest.Mock).mockRejectedValue(new AppAuthError('FORBIDDEN'));

    const res = await roleRoute(
      request(`/api/admin/users/${customer.userId}/role`, { body: { role: 'ADMIN' } }),
      params()
    );
    expect(res.status).toBe(403);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  test('a super admin can assign ADMIN through the role route', async () => {
    (setUserRole as jest.Mock).mockResolvedValue({ ...customer, role: 'ADMIN' });

    const res = await roleRoute(
      request(`/api/admin/users/${customer.userId}/role`, { body: { role: 'ADMIN' } }),
      params()
    );
    expect(res.status).toBe(200);
    expect(setUserRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'SUPER_ADMIN' }),
      customer.userId,
      'ADMIN'
    );
  });

  test('status mutations reject a cross-site origin before authorization', async () => {
    const res = await statusRoute(
      request(`/api/admin/users/${customer.userId}/status`, {
        method: 'PATCH',
        body: { status: 'SUSPENDED' },
        origin: 'https://evil.example',
      }),
      params()
    );
    expect(res.status).toBe(403);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  test('status mutations surface provisioning conflicts', async () => {
    const { ProvisioningError } = jest.requireActual('@/lib/auth/provisioning');
    (setUserStatus as jest.Mock).mockRejectedValue(
      new ProvisioningError(409, 'LAST_ADMIN', 'The last admin cannot be suspended.')
    );

    const res = await statusRoute(
      request(`/api/admin/users/${customer.userId}/status`, {
        method: 'PATCH',
        body: { status: 'SUSPENDED' },
      }),
      params()
    );
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('LAST_ADMIN');
  });
});
