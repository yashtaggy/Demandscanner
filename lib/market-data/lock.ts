/**
 * PostgreSQL-backed global ingestion lease.
 *
 * The scanner stays browser-driven: each POST /api/scanner/batch invocation
 * claims a scan job lease and processes one bounded slice. This table adds a
 * second, global guard so two different jobs (or two serverless instances)
 * cannot call the market-data provider at the same time.
 *
 * Properties:
 *   * Atomic acquire via a single INSERT ... ON CONFLICT statement.
 *   * A lease is reclaimable only after it expires (stale-lock recovery).
 *   * Release only affects the current owner.
 *   * No in-memory state and no read-only lock, so it works across instances.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export const GLOBAL_INGESTION_LOCK_NAME = "market-data:ingestion";
export const DEFAULT_INGESTION_LEASE_MS = 120_000;

export interface GlobalIngestionLock {
  lockName: string;
  owner: string;
  expiresAt: Date;
}

export interface AcquireIngestionLockOptions {
  owner?: string;
  leaseMs?: number;
  lockName?: string;
}

export class IngestionLockContendedError extends Error {
  readonly code = "INGESTION_IN_PROGRESS";
  readonly retryAfterMs: number;

  constructor(retryAfterMs = 15_000) {
    super("A market-data ingestion is already in progress. Retry shortly.");
    this.name = "IngestionLockContendedError";
    this.retryAfterMs = retryAfterMs;
  }
}

function toDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(Date.now() + 1000) : date;
}

/**
 * Atomically acquire the global ingestion lease.
 * Returns null when another live lease holds it.
 */
export async function acquireGlobalIngestionLock(
  options: AcquireIngestionLockOptions = {}
): Promise<GlobalIngestionLock | null> {
  const lockName = options.lockName ?? GLOBAL_INGESTION_LOCK_NAME;
  const owner = options.owner ?? randomUUID();
  const leaseMs = Math.max(1_000, options.leaseMs ?? DEFAULT_INGESTION_LEASE_MS);
  const sql = getDb();

  const rows = await sql`
    INSERT INTO global_ingestion_locks
      (lock_name, lease_owner, acquired_at, heartbeat_at, lease_expires_at, released_at)
    VALUES
      (${lockName}, ${owner}, NOW(), NOW(),
       NOW() + (${leaseMs}::int * INTERVAL '1 millisecond'), NULL)
    ON CONFLICT (lock_name) DO UPDATE SET
      lease_owner = EXCLUDED.lease_owner,
      acquired_at = NOW(),
      heartbeat_at = NOW(),
      lease_expires_at = EXCLUDED.lease_expires_at,
      released_at = NULL
    WHERE global_ingestion_locks.released_at IS NOT NULL
       OR global_ingestion_locks.lease_expires_at < NOW()
    RETURNING lock_name, lease_owner, lease_expires_at
  `;

  if (rows.length === 0) return null;

  const row = rows[0] as Record<string, unknown>;
  return {
    lockName: String(row.lock_name),
    owner: String(row.lease_owner),
    expiresAt: toDate(row.lease_expires_at),
  };
}

/**
 * Release the lease if (and only if) this owner still holds it.
 * Returns true when a row was released.
 */
export async function releaseGlobalIngestionLock(
  lock: Pick<GlobalIngestionLock, "lockName" | "owner">
): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`
    UPDATE global_ingestion_locks
       SET released_at = NOW(),
           heartbeat_at = NOW(),
           lease_expires_at = NOW()
     WHERE lock_name = ${lock.lockName}
       AND lease_owner = ${lock.owner}
       AND released_at IS NULL
     RETURNING lock_name
  `;
  return rows.length > 0;
}

/**
 * Extend a held lease. Returns false when the lease was lost (expired and
 * reclaimed, or released), so a long batch can abort instead of overlapping.
 */
export async function renewGlobalIngestionLock(
  lock: Pick<GlobalIngestionLock, "lockName" | "owner">,
  leaseMs = DEFAULT_INGESTION_LEASE_MS
): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`
    UPDATE global_ingestion_locks
       SET heartbeat_at = NOW(),
           lease_expires_at = NOW() + (${leaseMs}::int * INTERVAL '1 millisecond')
     WHERE lock_name = ${lock.lockName}
       AND lease_owner = ${lock.owner}
       AND released_at IS NULL
       AND lease_expires_at >= NOW()
     RETURNING lock_name
  `;
  return rows.length > 0;
}

/**
 * Run `fn` while holding the global lease. Throws IngestionLockContendedError
 * when another live lease exists. The lease is always released afterwards,
 * including on failure; a release error is logged and never masks the result.
 */
export async function withGlobalIngestionLock<T>(
  fn: (lock: GlobalIngestionLock) => Promise<T>,
  options: AcquireIngestionLockOptions = {}
): Promise<T> {
  const lock = await acquireGlobalIngestionLock(options);
  if (!lock) {
    throw new IngestionLockContendedError(
      Math.max(1_000, Math.round((options.leaseMs ?? DEFAULT_INGESTION_LEASE_MS) / 4))
    );
  }

  try {
    return await fn(lock);
  } finally {
    try {
      await releaseGlobalIngestionLock(lock);
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : "unknown";
      console.warn(`[market-data] failed to release ingestion lock: ${message}`);
    }
  }
}
