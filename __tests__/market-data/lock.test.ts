/**
 * Global ingestion lease.
 *
 * One PostgreSQL row serializes provider calls across jobs and instances.
 * These tests pin the acquire/release/renew contract, including that
 * contention is reported as a retryable condition and that release is
 * owner-scoped and runs even when the protected work fails.
 */

const mockDb = {
  acquireRows: [] as Array<Record<string, unknown>>,
  releaseRows: [] as Array<Record<string, unknown>>,
  renewRows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ query: string; values: unknown[] }>,
  releaseThrows: false,
};

jest.mock('@/lib/db', () => ({
  getDb: () => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('?');
      mockDb.calls.push({ query, values });
      if (query.includes('INSERT INTO global_ingestion_locks')) {
        return mockDb.acquireRows;
      }
      if (query.includes('SET released_at')) {
        if (mockDb.releaseThrows) throw new Error('db down while releasing');
        return mockDb.releaseRows;
      }
      if (query.includes('SET heartbeat_at')) {
        return mockDb.renewRows;
      }
      return [];
    };
    return sql;
  },
}));

import {
  DEFAULT_INGESTION_LEASE_MS,
  GLOBAL_INGESTION_LOCK_NAME,
  IngestionLockContendedError,
  acquireGlobalIngestionLock,
  releaseGlobalIngestionLock,
  renewGlobalIngestionLock,
  withGlobalIngestionLock,
} from '@/lib/market-data/lock';

const lease = {
  lockName: GLOBAL_INGESTION_LOCK_NAME,
  owner: 'owner-1',
  expiresAt: new Date(Date.now() + DEFAULT_INGESTION_LEASE_MS),
};

beforeEach(() => {
  mockDb.acquireRows = [];
  mockDb.releaseRows = [];
  mockDb.renewRows = [];
  mockDb.calls = [];
  mockDb.releaseThrows = false;
});

describe('acquireGlobalIngestionLock', () => {
  test('returns the lease when the atomic upsert acquires it', async () => {
    mockDb.acquireRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME, lease_owner: 'owner-1', lease_expires_at: lease.expiresAt }];

    const lock = await acquireGlobalIngestionLock({ owner: 'owner-1' });

    expect(lock).toMatchObject({ lockName: GLOBAL_INGESTION_LOCK_NAME, owner: 'owner-1' });
    expect(lock?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const { query, values } = mockDb.calls[0];
    // Reclaim only when released or expired — never a live lease.
    expect(query).toContain('WHERE global_ingestion_locks.released_at IS NOT NULL');
    expect(query).toContain('lease_expires_at < NOW()');
    expect(values).toEqual([GLOBAL_INGESTION_LOCK_NAME, 'owner-1', DEFAULT_INGESTION_LEASE_MS]);
  });

  test('returns null while another live lease is held (contention)', async () => {
    mockDb.acquireRows = [];
    expect(await acquireGlobalIngestionLock({ owner: 'owner-2' })).toBeNull();
  });

  test('clamps the requested lease to at least one second', async () => {
    mockDb.acquireRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME, lease_owner: 'o', lease_expires_at: new Date() }];
    await acquireGlobalIngestionLock({ owner: 'o', leaseMs: 1 });
    expect(mockDb.calls[0].values[2]).toBe(1000);
  });
});

describe('releaseGlobalIngestionLock', () => {
  test('releases only the current owner', async () => {
    mockDb.releaseRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME }];

    expect(await releaseGlobalIngestionLock(lease)).toBe(true);

    const { query, values } = mockDb.calls[0];
    expect(query).toContain('lease_owner = ?');
    expect(values).toEqual([GLOBAL_INGESTION_LOCK_NAME, 'owner-1']);
  });

  test('does not claim a release when the lease was already lost', async () => {
    mockDb.releaseRows = [];
    expect(await releaseGlobalIngestionLock(lease)).toBe(false);
  });
});

describe('renewGlobalIngestionLock', () => {
  test('extends only an unexpired lease held by the same owner', async () => {
    mockDb.renewRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME }];
    expect(await renewGlobalIngestionLock(lease, 60_000)).toBe(true);
    const { query } = mockDb.calls[0];
    expect(query).toContain('lease_owner = ?');
    expect(query).toContain('lease_expires_at >= NOW()');
  });

  test('reports a lost lease so long work can stop', async () => {
    mockDb.renewRows = [];
    expect(await renewGlobalIngestionLock(lease)).toBe(false);
  });
});

describe('withGlobalIngestionLock', () => {
  test('throws a retryable contention error when the lease is busy', async () => {
    mockDb.acquireRows = [];
    await expect(
      withGlobalIngestionLock(async () => 'never')
    ).rejects.toBeInstanceOf(IngestionLockContendedError);
  });

  test('releases the lease after success', async () => {
    mockDb.acquireRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME, lease_owner: 'owner-9', lease_expires_at: new Date() }];
    mockDb.releaseRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME }];

    const result = await withGlobalIngestionLock(async () => 'done', { owner: 'owner-9' });

    expect(result).toBe('done');
    const release = mockDb.calls.find((c) => c.query.includes('SET released_at'));
    expect(release?.values).toEqual([GLOBAL_INGESTION_LOCK_NAME, 'owner-9']);
  });

  test('releases the lease after the protected work throws', async () => {
    mockDb.acquireRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME, lease_owner: 'ignored', lease_expires_at: new Date() }];
    mockDb.releaseRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME }];

    await expect(
      withGlobalIngestionLock(async () => {
        throw new Error('provider exploded');
      }, { owner: 'owner-9' })
    ).rejects.toThrow('provider exploded');

    expect(mockDb.calls.some((c) => c.query.includes('SET released_at'))).toBe(true);
  });

  test('a failing release never masks the work result', async () => {
    mockDb.acquireRows = [{ lock_name: GLOBAL_INGESTION_LOCK_NAME, lease_owner: 'ignored', lease_expires_at: new Date() }];
    mockDb.releaseThrows = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      withGlobalIngestionLock(async () => 'kept', { owner: 'owner-9' })
    ).resolves.toBe('kept');

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
