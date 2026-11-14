/**
 * Bearer-secret authentication for the scheduled Signals dispatcher.
 *
 * This is intentionally separate from customer/admin session auth: only an
 * external scheduler that knows CRON_SECRET may invoke dispatch. The token is
 * compared in constant time, is never logged or echoed, and a missing server
 * secret fails closed.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const DISPATCH_AUTH_SCHEME = "Bearer";

/** Minimal environment surface so tests can pass a plain object. */
export type CronEnv = Readonly<Record<string, string | undefined>>;

export type DispatchAuthResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 503;
      code: "DISPATCH_NOT_CONFIGURED" | "UNAUTHORIZED";
      message: string;
    };

export function getCronSecret(env: CronEnv = process.env): string | null {
  const secret = env.CRON_SECRET?.trim();
  return secret ? secret : null;
}

function unauthorized(): DispatchAuthResult {
  return {
    ok: false,
    status: 401,
    code: "UNAUTHORIZED",
    message: "A valid dispatch credential is required.",
  };
}

export function verifyDispatchAuthorization(
  header: string | null | undefined,
  env: CronEnv = process.env
): DispatchAuthResult {
  const expected = getCronSecret(env);
  if (!expected) {
    return {
      ok: false,
      status: 503,
      code: "DISPATCH_NOT_CONFIGURED",
      message: "Scheduled signal dispatch is not configured.",
    };
  }

  if (!header) return unauthorized();

  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (!match) return unauthorized();

  const provided = match[1].trim();
  if (!provided) return unauthorized();

  // Hash first so differing lengths cannot throw and cannot leak length.
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();

  return timingSafeEqual(providedDigest, expectedDigest)
    ? { ok: true }
    : unauthorized();
}
