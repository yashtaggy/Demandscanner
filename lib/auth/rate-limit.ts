/**
 * Fixed-window rate limiter backed by PostgreSQL.
 *
 * Shared state (rather than per-process memory) keeps the limit effective
 * across Vercel serverless instances.
 *
 * The limiter FAILS CLOSED. Every caller is a sensitive authentication,
 * provisioning or administrative mutation, so if the limiter cannot be read
 * the request is refused with a temporary-unavailability response instead of
 * silently bypassing the limit. Client-facing errors never include the
 * database error; it is logged server-side only.
 */

import { getDb } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /** True when the limiter itself could not be consulted. */
  unavailable?: boolean;
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const rateKey = key.slice(0, 200);

  try {
    const sql = getDb();
    const rows = (await sql`
      INSERT INTO auth_rate_limits (
        rate_key, window_started_at, attempt_count, updated_at
      )
      VALUES (${rateKey}, NOW(), 1, NOW())
      ON CONFLICT (rate_key) DO UPDATE SET
        window_started_at = CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - auth_rate_limits.window_started_at))
               >= ${windowSeconds}
          THEN NOW()
          ELSE auth_rate_limits.window_started_at
        END,
        attempt_count = CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - auth_rate_limits.window_started_at))
               >= ${windowSeconds}
          THEN 1
          ELSE auth_rate_limits.attempt_count + 1
        END,
        updated_at = NOW()
      RETURNING
        attempt_count,
        EXTRACT(EPOCH FROM (NOW() - window_started_at)) AS elapsed_seconds
    `) as Array<{ attempt_count: number; elapsed_seconds: number | string }>;

    const used = Number(rows[0]?.attempt_count ?? 1);
    const elapsed = Number(rows[0]?.elapsed_seconds ?? 0);
    return {
      allowed: used <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsed)),
    };
  } catch (err) {
    // Log only a machine code/name: driver messages can embed hostnames or
    // connection details that must not reach logs.
    const reason =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "unknown")
        : err instanceof Error
          ? err.name
          : "unknown";
    console.error("[auth] rate limiter unavailable; failing closed:", reason);
    return {
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    };
  }
}
