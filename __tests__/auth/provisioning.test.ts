/**
 * Administrative provisioning and lifecycle tests.
 *
 * Firebase and PostgreSQL are mocked. The tests pin:
 *  - customers are created without a password and mapped through user_identities,
 *  - the reset link is returned once and never persisted or logged,
 *  - every failure after Firebase account creation compensates by deleting it,
 *  - role/status mutations enforce least privilege and last-admin protection,
 *  - every successful mutation writes an audit row in the same transaction.
 */

jest.mock('@/lib/db', () => {
  const sql = jest.fn(async () => []);
  (sql as unknown as { transaction: jest.Mock }).transaction = jest.fn(
    async (queries: unknown[]) => queries
  );
  return { getDb: () => sql };
});

jest.mock('@/lib/auth/firebase-admin', () => ({
  createFirebaseUser: jest.fn(),
  deleteFirebaseUser: jest.fn(),
  generatePasswordResetLink: jest.fn(),
  getFirebaseUserByEmail: jest.fn(),
  revokeFirebaseSessions: jest.fn(),
}));

jest.mock('@/lib/auth/repository', () => ({
  findAppUserByEmail: jest.fn(),
  findAppUserById: jest.fn(),
  countOtherActiveAdmins: jest.fn(),
  countOtherActiveSuperAdmins: jest.fn(),
}));

import { getDb } from '@/lib/db';
import {
  createFirebaseUser,
  deleteFirebaseUser,
  generatePasswordResetLink,
  getFirebaseUserByEmail,
  revokeFirebaseSessions,
} from '@/lib/auth/firebase-admin';
import {
  countOtherActiveAdmins,
  countOtherActiveSuperAdmins,
  findAppUserByEmail,
  findAppUserById,
} from '@/lib/auth/repository';
import {
  ProvisioningError,
  provisionCustomer,
  setUserRole,
  setUserStatus,
} from '@/lib/auth/provisioning';
import type { AppUser } from '@/lib/auth/types';

const mockSql = getDb() as unknown as jest.Mock & { transaction: jest.Mock };

const actor: AppUser = {
  userId: '00000000-0000-4000-8000-000000000010',
  email: 'admin@example.com',
  displayName: 'Admin',
  status: 'ACTIVE',
  role: 'ADMIN',
};

const customerTarget = {
  userId: '00000000-0000-4000-8000-000000000020',
  email: 'customer@example.com',
  displayName: 'Customer',
  status: 'ACTIVE' as const,
  role: 'CUSTOMER' as const,
  firebaseUid: 'firebase-customer',
};

function notFound(): never {
  throw Object.assign(new Error('no user record'), { code: 'auth/user-not-found' });
}

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
  mockSql.transaction.mockReset();
  mockSql.transaction.mockImplementation(async (queries: unknown[]) => queries);

  (createFirebaseUser as jest.Mock).mockReset().mockResolvedValue({ uid: 'firebase-new' });
  (deleteFirebaseUser as jest.Mock).mockReset().mockResolvedValue(undefined);
  (generatePasswordResetLink as jest.Mock)
    .mockReset()
    .mockResolvedValue('https://reset.example/one-time-link');
  (getFirebaseUserByEmail as jest.Mock).mockReset().mockImplementation(async () => notFound());
  (revokeFirebaseSessions as jest.Mock).mockReset().mockResolvedValue(undefined);

  (findAppUserByEmail as jest.Mock).mockReset().mockResolvedValue(null);
  (findAppUserById as jest.Mock).mockReset().mockResolvedValue(customerTarget);
  (countOtherActiveAdmins as jest.Mock).mockReset().mockResolvedValue(1);
  (countOtherActiveSuperAdmins as jest.Mock).mockReset().mockResolvedValue(1);
});

function executedSql(): string {
  return mockSql.mock.calls
    .map(([strings]) => (strings as TemplateStringsArray).join('?'))
    .join('\n');
}

function executedValues(): unknown[] {
  return mockSql.mock.calls.flatMap(([, ...values]) => values);
}

describe('provisionCustomer', () => {
  test('creates a passwordless Firebase user, a CUSTOMER row, an identity and an audit entry', async () => {
    const result = await provisionCustomer(actor, {
      email: ' New.Customer@Example.com ',
      displayName: '  New   Customer ',
    });

    expect(createFirebaseUser).toHaveBeenCalledWith({
      email: 'new.customer@example.com',
      displayName: 'New Customer',
      emailVerified: false,
    });
    const firebaseArgs = (createFirebaseUser as jest.Mock).mock.calls[0][0];
    expect(firebaseArgs).not.toHaveProperty('password');

    expect(result.user).toMatchObject({
      email: 'new.customer@example.com',
      displayName: 'New Customer',
      status: 'ACTIVE',
      role: 'CUSTOMER',
    });
    expect(result.resetLink).toBe('https://reset.example/one-time-link');

    const sql = executedSql();
    expect(sql).toContain('INSERT INTO app_users');
    expect(sql).toContain('INSERT INTO user_identities');
    expect(sql).toContain("'FIREBASE'");
    expect(sql).toContain('INSERT INTO admin_audit_log');
    expect(sql).toContain('CUSTOMER_PROVISIONED');
    expect(mockSql.transaction).toHaveBeenCalledTimes(1);
  });

  test('never persists or logs the one-time reset link', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    await provisionCustomer(actor, { email: 'new@example.com' });

    expect(JSON.stringify(executedValues())).not.toContain('one-time-link');
    expect(JSON.stringify(log.mock.calls)).not.toContain('one-time-link');
    expect(JSON.stringify(info.mock.calls)).not.toContain('one-time-link');

    log.mockRestore();
    info.mockRestore();
  });

  test('rejects an invalid email before calling Firebase', async () => {
    await expect(
      provisionCustomer(actor, { email: 'not-an-email' })
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    expect(createFirebaseUser).not.toHaveBeenCalled();
  });

  test('rejects an email that already exists in app_users', async () => {
    (findAppUserByEmail as jest.Mock).mockResolvedValue(customerTarget);

    await expect(
      provisionCustomer(actor, { email: customerTarget.email })
    ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
    expect(createFirebaseUser).not.toHaveBeenCalled();
  });

  test('rejects an unlinked Firebase account instead of taking it over', async () => {
    (getFirebaseUserByEmail as jest.Mock).mockResolvedValue({ uid: 'foreign' });

    await expect(
      provisionCustomer(actor, { email: 'foreign@example.com' })
    ).rejects.toMatchObject({ code: 'FIREBASE_EMAIL_EXISTS' });
    expect(createFirebaseUser).not.toHaveBeenCalled();
  });

  test('returns a safe failure when Firebase creation fails', async () => {
    (createFirebaseUser as jest.Mock).mockRejectedValue(new Error('quota exceeded'));

    await expect(
      provisionCustomer(actor, { email: 'new@example.com' })
    ).rejects.toMatchObject({ code: 'PROVISIONING_FAILED' });
    expect(mockSql.transaction).not.toHaveBeenCalled();
  });

  test('deletes the Firebase user when reset-link generation fails', async () => {
    (generatePasswordResetLink as jest.Mock).mockRejectedValue(new Error('link failed'));

    await expect(
      provisionCustomer(actor, { email: 'new@example.com' })
    ).rejects.toMatchObject({ code: 'PROVISIONING_FAILED' });
    expect(deleteFirebaseUser).toHaveBeenCalledWith('firebase-new');
  });

  test('deletes the Firebase user when the database transaction fails', async () => {
    mockSql.transaction.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      provisionCustomer(actor, { email: 'new@example.com' })
    ).rejects.toMatchObject({ code: 'PROVISIONING_FAILED' });
    expect(deleteFirebaseUser).toHaveBeenCalledWith('firebase-new');
  });

  test('maps a unique violation to EMAIL_EXISTS and compensates', async () => {
    mockSql.transaction.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' })
    );

    await expect(
      provisionCustomer(actor, { email: 'new@example.com' })
    ).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
    expect(deleteFirebaseUser).toHaveBeenCalledWith('firebase-new');
  });
});

describe('setUserStatus', () => {
  test('rejects an unknown status', async () => {
    await expect(
      setUserStatus(actor, customerTarget.userId, 'DELETED')
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  test('an admin cannot manage another administrator', async () => {
    (findAppUserById as jest.Mock).mockResolvedValue({ ...customerTarget, role: 'ADMIN' });

    await expect(
      setUserStatus(actor, customerTarget.userId, 'SUSPENDED')
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(mockSql.transaction).not.toHaveBeenCalled();
  });

  test('suspending a customer writes an audit row and revokes Firebase sessions', async () => {
    const updated = await setUserStatus(actor, customerTarget.userId, 'SUSPENDED');

    expect(updated).toMatchObject({ status: 'SUSPENDED', role: 'CUSTOMER' });
    expect(executedValues()).toContain('USER_SUSPENDED');
    expect(revokeFirebaseSessions).toHaveBeenCalledWith('firebase-customer');
  });

  test('a super admin cannot suspend the last active super admin', async () => {
    const superActor: AppUser = { ...actor, role: 'SUPER_ADMIN' };
    (findAppUserById as jest.Mock).mockResolvedValue({
      ...customerTarget,
      role: 'SUPER_ADMIN',
    });
    (countOtherActiveSuperAdmins as jest.Mock).mockResolvedValue(0);

    await expect(
      setUserStatus(superActor, customerTarget.userId, 'DISABLED')
    ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
  });

  test('a super admin cannot suspend the last active admin', async () => {
    const superActor: AppUser = { ...actor, role: 'SUPER_ADMIN' };
    (findAppUserById as jest.Mock).mockResolvedValue({ ...customerTarget, role: 'ADMIN' });
    (countOtherActiveAdmins as jest.Mock).mockResolvedValue(0);

    await expect(
      setUserStatus(superActor, customerTarget.userId, 'SUSPENDED')
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });
});

describe('setUserRole', () => {
  test('only a super admin can change roles', async () => {
    await expect(
      setUserRole(actor, customerTarget.userId, 'ADMIN')
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  test('only ADMIN and CUSTOMER can be assigned', async () => {
    const superActor: AppUser = { ...actor, role: 'SUPER_ADMIN' };
    await expect(
      setUserRole(superActor, customerTarget.userId, 'SUPER_ADMIN')
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ASSIGNABLE' });
  });

  test('an administrator cannot change their own role', async () => {
    const superActor: AppUser = { ...actor, role: 'SUPER_ADMIN' };
    await expect(
      setUserRole(superActor, superActor.userId, 'CUSTOMER')
    ).rejects.toMatchObject({ code: 'SELF_ROLE_CHANGE' });
  });

  test('a super admin can promote a customer and the change is audited', async () => {
    const superActor: AppUser = { ...actor, role: 'SUPER_ADMIN' };
    const updated = await setUserRole(superActor, customerTarget.userId, 'ADMIN');

    expect(updated).toMatchObject({ role: 'ADMIN' });
    expect(executedSql()).toContain('USER_ROLE_CHANGED');
  });

  test('the last active super admin cannot be demoted', async () => {
    const superActor: AppUser = { ...actor, role: 'SUPER_ADMIN' };
    (findAppUserById as jest.Mock).mockResolvedValue({
      ...customerTarget,
      role: 'SUPER_ADMIN',
    });
    (countOtherActiveSuperAdmins as jest.Mock).mockResolvedValue(0);

    await expect(
      setUserRole(superActor, customerTarget.userId, 'CUSTOMER')
    ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
  });
});

test('provisioning errors carry their HTTP status', () => {
  const err = new ProvisioningError(409, 'EMAIL_EXISTS', 'exists');
  expect(err.status).toBe(409);
  expect(err.code).toBe('EMAIL_EXISTS');
});
