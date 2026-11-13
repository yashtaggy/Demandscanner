/**
 * Central authorization unit tests.
 *
 * Firebase and PostgreSQL are mocked. These pin the rules that make ownership
 * safe: the session cookie must verify, the Firebase UID must map to exactly
 * one app_users row, and role/status always come from PostgreSQL.
 */

const mockSql = jest.fn();

jest.mock('@/lib/db', () => ({
  getDb: () => mockSql,
}));

jest.mock('@/lib/auth/firebase-admin', () => ({
  verifyAppSessionCookie: jest.fn(),
}));

import { verifyAppSessionCookie } from '@/lib/auth/firebase-admin';
import {
  findAppUserByFirebaseUid,
  requireAdmin,
  requireAppUser,
  requireAppUserSession,
  requireSuperAdmin,
} from '@/lib/auth/session';
import { AppAuthError } from '@/lib/auth/types';

const verifyMock = verifyAppSessionCookie as jest.Mock;

const CUSTOMER_ROW = {
  user_id: '00000000-0000-4000-8000-000000000001',
  email: 'customer@example.com',
  display_name: 'Customer',
  status: 'ACTIVE',
  role: 'CUSTOMER',
};

function cookie(value = 'session-cookie') {
  return `other=1; ds_app_session=${value}`;
}

beforeEach(() => {
  mockSql.mockReset();
  verifyMock.mockReset();
  verifyMock.mockResolvedValue({ uid: 'firebase-uid-1' });
});

describe('requireAppUser', () => {
  test('rejects a request with no app session cookie before touching Firebase', async () => {
    await expect(requireAppUser(null)).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  test('rejects an invalid or revoked session cookie', async () => {
    verifyMock.mockRejectedValue(new Error('revoked'));
    await expect(requireAppUser(cookie())).rejects.toMatchObject({
      reason: 'INVALID_SESSION',
    });
  });

  test('fails closed when the Firebase UID has no identity mapping', async () => {
    mockSql.mockResolvedValue([]);
    await expect(requireAppUser(cookie())).rejects.toMatchObject({
      reason: 'NO_IDENTITY',
    });
  });

  test('fails closed on an ambiguous identity mapping', async () => {
    mockSql.mockResolvedValue([CUSTOMER_ROW, { ...CUSTOMER_ROW, user_id: 'other' }]);
    await expect(requireAppUser(cookie())).rejects.toMatchObject({
      reason: 'AMBIGUOUS_IDENTITY',
    });
  });

  test.each(['SUSPENDED', 'DISABLED'])('blocks a %s user even with a valid session', async (status) => {
    mockSql.mockResolvedValue([{ ...CUSTOMER_ROW, status }]);
    await expect(requireAppUser(cookie())).rejects.toMatchObject({ reason: status });
  });

  test('rejects an unknown stored role instead of guessing', async () => {
    mockSql.mockResolvedValue([{ ...CUSTOMER_ROW, role: 'OWNER' }]);
    await expect(requireAppUser(cookie())).rejects.toBeInstanceOf(AppAuthError);
  });

  test('returns the internal user id and database role for an active user', async () => {
    mockSql.mockResolvedValue([CUSTOMER_ROW]);
    const user = await requireAppUser(cookie());

    expect(user).toEqual({
      userId: CUSTOMER_ROW.user_id,
      email: CUSTOMER_ROW.email,
      displayName: CUSTOMER_ROW.display_name,
      status: 'ACTIVE',
      role: 'CUSTOMER',
    });
  });

  test('resolves the identity by Firebase UID stored in user_identities', async () => {
    mockSql.mockResolvedValue([CUSTOMER_ROW]);
    await requireAppUser(cookie());
    const [strings, ...values] = mockSql.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('user_identities');
    expect(strings.join('?')).toContain('provider_user_id');
    expect(values).toContain('firebase-uid-1');
  });

  test('requireAppUserSession exposes the verified Firebase UID only after status checks', async () => {
    mockSql.mockResolvedValue([CUSTOMER_ROW]);
    await expect(requireAppUserSession(cookie())).resolves.toEqual({
      user: expect.objectContaining({ userId: CUSTOMER_ROW.user_id, role: 'CUSTOMER' }),
      firebaseUid: 'firebase-uid-1',
    });

    mockSql.mockResolvedValue([{ ...CUSTOMER_ROW, status: 'DISABLED' }]);
    await expect(requireAppUserSession(cookie())).rejects.toMatchObject({
      reason: 'DISABLED',
    });
  });
});

describe('role guards', () => {
  test('a customer is denied admin access', async () => {
    mockSql.mockResolvedValue([CUSTOMER_ROW]);
    await expect(requireAdmin(cookie())).rejects.toMatchObject({ reason: 'FORBIDDEN' });
  });

  test('an admin is not a super admin', async () => {
    mockSql.mockResolvedValue([{ ...CUSTOMER_ROW, role: 'ADMIN' }]);
    await expect(requireSuperAdmin(cookie())).rejects.toMatchObject({
      reason: 'FORBIDDEN',
    });
  });

  test('an admin passes requireAdmin and a super admin passes both', async () => {
    mockSql.mockResolvedValue([{ ...CUSTOMER_ROW, role: 'ADMIN' }]);
    await expect(requireAdmin(cookie())).resolves.toMatchObject({ role: 'ADMIN' });

    mockSql.mockResolvedValue([{ ...CUSTOMER_ROW, role: 'SUPER_ADMIN' }]);
    await expect(requireAdmin(cookie())).resolves.toMatchObject({ role: 'SUPER_ADMIN' });
    await expect(requireSuperAdmin(cookie())).resolves.toMatchObject({
      role: 'SUPER_ADMIN',
    });
  });
});

describe('findAppUserByFirebaseUid', () => {
  test('requires a non-empty UID', async () => {
    await expect(findAppUserByFirebaseUid('')).rejects.toMatchObject({
      reason: 'NO_IDENTITY',
    });
  });

  test('never returns a user for a missing mapping', async () => {
    mockSql.mockResolvedValue([]);
    await expect(findAppUserByFirebaseUid('unknown')).rejects.toMatchObject({
      reason: 'NO_IDENTITY',
    });
  });
});
