/**
 * Scanner integration with the global ingestion lease and system context.
 *
 * These tests pin the behaviour required for multi-user scans:
 *  - provider stages acquire and always release the PostgreSQL lease,
 *  - contention defers the job instead of calling the provider twice,
 *  - the resolved market-data context (not the customer token) reaches ingestion,
 *  - a missing system connection fails the job permanently,
 *  - stages that do not touch the provider never take the lease.
 */

import type { KiteSession } from '@/lib/types';
import type { ScanJobRow } from '@/lib/scanner/jobs';
import type { MarketDataContext } from '@/lib/market-data/types';
import { MarketDataUnavailableError } from '@/lib/market-data/errors';
import {
  processScanBatch,
  type ScanJobStore,
  type ScanWorkers,
} from '@/lib/scanner/batchRunner';

const session: KiteSession = {
  accessToken: 'customer-token',
  userId: 'customer',
  userName: 'Customer',
  email: 'customer@example.com',
  loginTime: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const systemContext: MarketDataContext = {
  provider: 'KITE',
  credentials: { accessToken: 'system-token', apiKey: 'system-app-key' },
  source: 'SYSTEM',
  connectionId: 'connection-1',
};

const lock = {
  lockName: 'market-data:ingestion',
  owner: 'owner-1',
  expiresAt: new Date(Date.now() + 120_000),
};

function makeJob(overrides: Partial<ScanJobRow> = {}): ScanJobRow {
  return {
    job_id: 'job-1',
    started_at: new Date(),
    completed_at: null,
    status: 'PENDING',
    progress_percent: 0,
    error_message: null,
    config_id: 'cfg-1',
    initiator_user_id: null,
    session_id_hash: 'hash:sid',
    from_date: new Date('2024-10-01'),
    to_date: new Date('2024-10-15'),
    concurrency: 5,
    current_stage: 'INGEST_DAILY',
    cursor_instrument_id: 0,
    instrument_ids: [101],
    requested_symbols: null,
    retry_count: 0,
    max_retries: 3,
    lease_owner: null,
    lease_expires_at: null,
    total_instruments: 1,
    processed_instruments: 0,
    ...overrides,
  };
}

class LiteStore implements ScanJobStore {
  job: ScanJobRow;
  batches: string[] = [];
  persistCalls: Array<Parameters<ScanJobStore['persist']>[0]> = [];

  constructor(job: ScanJobRow) {
    this.job = { ...job };
  }

  claim: ScanJobStore['claim'] = async ({ leaseOwner }) => {
    this.job = { ...this.job, status: 'RUNNING', lease_owner: leaseOwner };
    return this.job;
  };

  insertBatch: ScanJobStore['insertBatch'] = async () => {
    const id = `batch-${this.batches.length + 1}`;
    this.batches.push(id);
    return id;
  };

  completeBatch: ScanJobStore['completeBatch'] = async () => {};

  failBatch: ScanJobStore['failBatch'] = async () => {};

  persist: ScanJobStore['persist'] = async (opts) => {
    this.persistCalls.push(opts);
    this.job = {
      ...this.job,
      status: opts.status,
      current_stage: opts.stage,
      cursor_instrument_id: opts.cursorInstrumentId,
      processed_instruments: opts.processedInstruments,
      total_instruments: opts.totalInstruments,
      progress_percent: opts.progressPercent,
      retry_count: opts.retryCount,
      instrument_ids: opts.instrumentIds ?? this.job.instrument_ids,
      error_message: opts.errorMessage ?? null,
      completed_at: opts.completedAt ?? null,
      lease_owner: null,
    };
    return this.job;
  };

  getJob: ScanJobStore['getJob'] = async () => this.job;
}

function makeWorkers(overrides: Partial<ScanWorkers> = {}): ScanWorkers {
  return {
    syncMaster: jest.fn(async () => ({
      upserted: 1,
      membershipSeeded: 500,
      universe: {
        seeded: 500,
        curated: 500,
        matched: 500,
        removed: 0,
        missingSymbols: [],
        inactiveSymbols: [],
        ambiguousSymbols: [],
        excludedPlaceholders: [],
      },
    })),
    listActiveIds: jest.fn(async (ids?: number[]) => ids ?? [101]),
    resolveNifty500: jest.fn(async () => [101]),
    resolveSymbols: jest.fn(async () => [101]),
    ingestDaily: jest.fn(async () => 1),
    ingestHourly: jest.fn(async () => 1),
    aggregateDaily: jest.fn(async () => undefined),
    aggregate4H: jest.fn(async () => 0),
    detectZones: jest.fn(async () => ({
      instrumentId: 101,
      outcomes: [],
      failedTimeframes: [],
      durationMs: 0,
    })),
    snapshots: jest.fn(async () => []),
    lifecycles: jest.fn(async () => undefined),
    loadSession: jest.fn(async () => session),
    resolveMarketData: jest.fn(async () => systemContext),
    acquireIngestionLock: jest.fn(async () => lock),
    releaseIngestionLock: jest.fn(async () => true),
    markMarketDataUsed: jest.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('global ingestion lease in processScanBatch', () => {
  test('acquires the lease, ingests with the system context and releases it', async () => {
    const store = new LiteStore(makeJob());
    const workers = makeWorkers();

    const result = await processScanBatch({ jobId: 'job-1', session }, store, workers);

    expect(workers.acquireIngestionLock).toHaveBeenCalledTimes(1);
    expect(workers.resolveMarketData).toHaveBeenCalledWith(session);
    expect(workers.ingestDaily).toHaveBeenCalledWith(systemContext, 101, expect.any(Date), expect.any(Date));
    expect(workers.markMarketDataUsed).toHaveBeenCalledWith(systemContext);
    expect(workers.releaseIngestionLock).toHaveBeenCalledWith(lock);
    expect(result.status).toBe('RUNNING');
    expect(store.batches).toHaveLength(1);
  });

  test('defers the job without a provider call while another ingestion holds the lease', async () => {
    const store = new LiteStore(makeJob());
    const workers = makeWorkers({ acquireIngestionLock: jest.fn(async () => null) });

    const result = await processScanBatch({ jobId: 'job-1', session }, store, workers);

    expect(result.claimed).toBe(true);
    expect(result.status).toBe('RUNNING');
    expect(result.moreRemaining).toBe(true);
    expect(result.retryAfterMs).toBe(15_000);
    expect(store.batches).toHaveLength(0);
    expect(workers.ingestDaily).not.toHaveBeenCalled();
    expect(workers.releaseIngestionLock).not.toHaveBeenCalled();
    expect(store.persistCalls[0].retryCount).toBe(0);
    expect(store.job.cursor_instrument_id).toBe(0);
  });

  test('releases the lease when the provider work fails', async () => {
    const store = new LiteStore(makeJob());
    const workers = makeWorkers({
      ingestDaily: jest.fn(async () => {
        throw new Error('socket hang up');
      }),
    });

    const result = await processScanBatch({ jobId: 'job-1', session }, store, workers);

    expect(result.status).toBe('RUNNING');
    expect(result.errorMessage).toBe('socket hang up');
    expect(workers.releaseIngestionLock).toHaveBeenCalledWith(lock);
    expect(workers.markMarketDataUsed).not.toHaveBeenCalled();
  });

  test('does not take the lease for non-provider stages', async () => {
    const store = new LiteStore(makeJob({ current_stage: 'AGGREGATE_DAILY' }));
    const workers = makeWorkers();

    await processScanBatch({ jobId: 'job-1', session }, store, workers);

    expect(workers.acquireIngestionLock).not.toHaveBeenCalled();
    expect(workers.aggregateDaily).toHaveBeenCalled();
    expect(workers.releaseIngestionLock).not.toHaveBeenCalled();
  });

  test('fails permanently and releases the lease when no market-data context is available', async () => {
    const store = new LiteStore(makeJob({ max_retries: 5 }));
    const workers = makeWorkers({
      resolveMarketData: jest.fn(async () => {
        throw new MarketDataUnavailableError('No system market-data connection is configured for KITE.');
      }),
    });

    const result = await processScanBatch({ jobId: 'job-1', session }, store, workers);

    expect(result.status).toBe('FAILED');
    expect(result.moreRemaining).toBe(false);
    expect(result.errorMessage).toContain('No system market-data connection');
    expect(workers.ingestDaily).not.toHaveBeenCalled();
    expect(workers.releaseIngestionLock).toHaveBeenCalledWith(lock);
    expect(store.job.completed_at).toBeTruthy();
  });

  test('two simultaneous scan initiations never both reach the provider', async () => {
    // The database lease is the arbiter: only one acquire returns a lock.
    let held = false;
    const acquireIngestionLock = jest.fn(async () => {
      if (held) return null;
      held = true;
      return lock;
    });
    const releaseIngestionLock = jest.fn(async () => {
      held = false;
      return true;
    });

    const firstStore = new LiteStore(makeJob({ job_id: 'job-a' }));
    const secondStore = new LiteStore(makeJob({ job_id: 'job-b' }));
    const ingestDaily = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 1;
    });

    const [first, second] = await Promise.all([
      processScanBatch(
        { jobId: 'job-a', session },
        firstStore,
        makeWorkers({ acquireIngestionLock, releaseIngestionLock, ingestDaily })
      ),
      processScanBatch(
        { jobId: 'job-b', session },
        secondStore,
        makeWorkers({ acquireIngestionLock, releaseIngestionLock, ingestDaily })
      ),
    ]);

    expect(first.errorMessage).toBeNull();
    expect(second.retryAfterMs).toBe(15_000);
    expect(ingestDaily).toHaveBeenCalledTimes(1);
    expect(secondStore.batches).toHaveLength(0);
  });
});
