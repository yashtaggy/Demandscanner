/**
 * Provider error normalization.
 *
 * Adapters rethrow provider errors unchanged. This module classifies a raw
 * error into a stable, provider-independent kind for routes, logging and
 * future Upstox adapters. Classification never requires the raw error to be a
 * Kite SDK type.
 */

import type { MarketDataProviderName } from "./types";

export type MarketDataErrorKind =
  | "AUTH_EXPIRED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR";

export interface ClassifiedMarketDataError {
  kind: MarketDataErrorKind;
  provider: MarketDataProviderName;
  retryable: boolean;
}

/** Thrown when no usable system market-data connection is available. */
export class MarketDataUnavailableError extends Error {
  readonly code = "MARKET_DATA_NOT_CONFIGURED";
  /** Permanent for the scan-retry classifier: retrying cannot fix config. */
  readonly permanent = true;

  constructor(message: string) {
    super(message);
    this.name = "MarketDataUnavailableError";
  }
}

/** Kite SDK errors expose `statusCode`/`error_type`; upstream errors often do. */
export function classifyMarketDataProviderError(
  err: unknown,
  provider: MarketDataProviderName = "KITE"
): ClassifiedMarketDataError {
  const e = err as
    | { statusCode?: number; error_type?: unknown; code?: unknown; message?: unknown }
    | null;
  const status =
    typeof e?.statusCode === "number"
      ? e.statusCode
      : typeof e?.code === "number"
        ? e.code
        : null;
  const message = String(e?.message ?? "");
  const errorType = String(e?.error_type ?? "");

  if (
    status === 401 ||
    /TokenException|Invalid `access_token`|token is invalid|SessionExpired|session expired/i.test(
      message
    ) ||
    /TokenException/i.test(errorType)
  ) {
    return { kind: "AUTH_EXPIRED", provider, retryable: false };
  }

  if (
    status === 403 ||
    /PermissionException|permission denied|not permitted|insufficient permission/i.test(
      message
    )
  ) {
    return { kind: "PERMISSION_DENIED", provider, retryable: false };
  }

  if (
    status === 429 ||
    /rate limit|too many requests|TooManyRequests/i.test(message) ||
    /TooManyRequests/i.test(errorType)
  ) {
    return { kind: "RATE_LIMITED", provider, retryable: true };
  }

  if (
    status === 400 ||
    status === 404 ||
    /Invalid `|invalid.*(symbol|token|instrument|from|to)/i.test(message)
  ) {
    return { kind: "INVALID_REQUEST", provider, retryable: false };
  }

  if (
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|socket hang up|fetch failed|network|timeout/i.test(
      message
    )
  ) {
    return { kind: "NETWORK", provider, retryable: true };
  }

  return {
    kind: "PROVIDER_ERROR",
    provider,
    retryable: typeof status === "number" && status >= 500,
  };
}

/** True when an auth failure should force a reconnect rather than a retry. */
export function isAuthExpiredError(err: unknown): boolean {
  return classifyMarketDataProviderError(err).kind === "AUTH_EXPIRED";
}
