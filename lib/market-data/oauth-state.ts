/**
 * Single-use OAuth state for the operator system-connection flow.
 *
 * The plaintext state is generated with 256 bits of entropy, stored in an
 * HttpOnly cookie, and echoed by the provider. Only its SHA-256 hash is stored
 * in the database. Verification consumes the row atomically, so a replayed
 * state can never be used twice.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getDb } from "@/lib/db";
import type { MarketDataProviderName } from "./types";

export const MARKET_DATA_OAUTH_STATE_COOKIE = "ds_md_oauth_state";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** Constant-time comparison of a cookie state and a callback state. */
export function oauthStateMatches(
  cookieState: string | null | undefined,
  callbackState: string | null | undefined
): boolean {
  if (!cookieState || !callbackState) return false;
  const a = createHash("sha256").update(cookieState).digest();
  const b = createHash("sha256").update(callbackState).digest();
  return timingSafeEqual(a, b);
}

export async function persistOAuthState(input: {
  state: string;
  provider: MarketDataProviderName;
  ttlMs?: number;
}): Promise<void> {
  const sql = getDb();
  const ttlMs = Math.max(60_000, input.ttlMs ?? OAUTH_STATE_TTL_MS);
  const rows = await sql`
    INSERT INTO market_data_oauth_states
      (state_hash, provider, created_at, expires_at)
    VALUES
      (${hashOAuthState(input.state)}, ${input.provider}, NOW(),
       NOW() + (${ttlMs}::int * INTERVAL '1 millisecond'))
    ON CONFLICT (state_hash) DO NOTHING
    RETURNING state_hash
  `;
  if (rows.length === 0) {
    throw new Error("Could not create a unique OAuth state.");
  }
}

/**
 * Atomically consume a state. Returns false when it is unknown, expired,
 * already consumed, or was issued for a different provider.
 */
export async function consumeOAuthState(input: {
  state: string;
  provider: MarketDataProviderName;
}): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`
    UPDATE market_data_oauth_states
       SET consumed_at = NOW()
     WHERE state_hash = ${hashOAuthState(input.state)}
       AND provider = ${input.provider}
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING state_hash
  `;
  return rows.length > 0;
}

/** Operational cleanup of expired, never-consumed state rows. */
export async function cleanupExpiredOAuthStates(): Promise<number> {
  const sql = getDb();
  const rows = await sql`
    DELETE FROM market_data_oauth_states
     WHERE expires_at < NOW()
     RETURNING state_hash
  `;
  return rows.length;
}
