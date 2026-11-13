/**
 * PostgreSQL rate-limiter unit tests.
 *
 * The limiter is the only throttle on session creation, customer provisioning
 * and administrative mutations, so a database failure must fail closed rather
 * than silently allow unlimited attempts.
 */

const mockSql = jest.fn();
const mockGetDb = jest.fn(() => mockSql);

jest.mock('@/lib/db', () => ({
  getDb: () => mockGetDb(),
}));

import { consumeRateLimit } from '@/lib/auth/rate-limit';

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  mockSql.mockReset();
  mockGetDb.mockReset();
  mockGetDb.mockImplementation(() => mockSql);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('consumeRateLimit', () => {
  test('allows a request inside the window and reports the remaining time', async () => {
    mockSql.mockResolvedValue([{ attempt_count: 5, elapsed_seconds: 20 }]);

    await expect(consumeRateLimit('session:ip:1.2.3.4', 30, 300)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 280,
    });
  });

  test('denies a request that exceeds the limit', async () => {
    mockSql.mockResolvedValue([{ attempt_count: 31, elapsed_seconds: 299 }]);

    await expect(consumeRateLimit('session:ip:1.2.3.4', 30, 300)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  test('fails closed when the database connection cannot be obtained', async () => {
    mockGetDb.mockImplementation(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    });

    const result = await consumeRateLimit('session:ip:1.2.3.4', 30, 300);

    expect(result).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('ECONNREFUSED');
  });

  test('fails closed when the rate-limit query fails', async () => {
    mockSql.mockRejectedValue(new Error('relation "auth_rate_limits" does not exist'));

    const result = await consumeRateLimit('session:ip:1.2.3.4', 30, 300);

    expect(result).toMatchObject({ allowed: false, unavailable: true });
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('recovers automatically once the database is available again', async () => {
    mockSql.mockRejectedValueOnce(new Error('connection reset'));

    const failed = await consumeRateLimit('session:ip:1.2.3.4', 30, 300);
    expect(failed).toMatchObject({ allowed: false, unavailable: true });

    mockSql.mockResolvedValueOnce([{ attempt_count: 1, elapsed_seconds: 0 }]);
    const recovered = await consumeRateLimit('session:ip:1.2.3.4', 30, 300);
    expect(recovered).toEqual({ allowed: true, retryAfterSeconds: 300 });
  });
});
