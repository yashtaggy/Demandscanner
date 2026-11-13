/**
 * Provider error normalization and timestamp normalization.
 *
 * Routes and the retry classifier must not depend on Kite SDK error classes.
 * These tests pin the mapping from raw provider shapes to stable internal kinds
 * and the timestamp contract services rely on.
 */

import {
  MarketDataUnavailableError,
  classifyMarketDataProviderError,
  isAuthExpiredError,
} from '@/lib/market-data/errors';
import { normalizeProviderTimestamp } from '@/lib/market-data/timestamps';

describe('classifyMarketDataProviderError', () => {
  test('maps token failures to AUTH_EXPIRED and marks them non-retryable', () => {
    const structured = { error_type: 'TokenException', message: 'bad token' };
    expect(classifyMarketDataProviderError(structured)).toEqual({
      kind: 'AUTH_EXPIRED',
      provider: 'KITE',
      retryable: false,
    });
    expect(
      classifyMarketDataProviderError(new Error('Invalid `access_token`')).kind
    ).toBe('AUTH_EXPIRED');
    expect(classifyMarketDataProviderError({ statusCode: 401 }).kind).toBe(
      'AUTH_EXPIRED'
    );
  });

  test('maps permission failures to PERMISSION_DENIED', () => {
    expect(
      classifyMarketDataProviderError({
        error_type: 'PermissionException',
        message: 'not permitted',
      }).kind
    ).toBe('PERMISSION_DENIED');
    expect(classifyMarketDataProviderError({ statusCode: 403 }).kind).toBe(
      'PERMISSION_DENIED'
    );
  });

  test('maps rate limits to a retryable RATE_LIMITED', () => {
    expect(
      classifyMarketDataProviderError(new Error('Too many requests'))
    ).toMatchObject({ kind: 'RATE_LIMITED', retryable: true });
    expect(classifyMarketDataProviderError({ statusCode: 429 }).kind).toBe(
      'RATE_LIMITED'
    );
  });

  test('maps invalid input to INVALID_REQUEST without retrying', () => {
    expect(
      classifyMarketDataProviderError({
        error_type: 'InputException',
        message: 'Invalid `from` date',
      })
    ).toMatchObject({ kind: 'INVALID_REQUEST', retryable: false });
    expect(classifyMarketDataProviderError({ statusCode: 400 }).kind).toBe(
      'INVALID_REQUEST'
    );
  });

  test('maps network errors to retryable NETWORK', () => {
    expect(
      classifyMarketDataProviderError(new Error('socket hang up'))
    ).toMatchObject({ kind: 'NETWORK', retryable: true });
    expect(
      classifyMarketDataProviderError(new Error('getaddrinfo ENOTFOUND'))
    ).toMatchObject({ kind: 'NETWORK', retryable: true });
  });

  test('falls back to PROVIDER_ERROR with 5xx retryability', () => {
    expect(classifyMarketDataProviderError(new Error('weird'))).toEqual({
      kind: 'PROVIDER_ERROR',
      provider: 'KITE',
      retryable: false,
    });
    expect(classifyMarketDataProviderError({ statusCode: 502 })).toMatchObject({
      kind: 'PROVIDER_ERROR',
      retryable: true,
    });
  });

  test('reports the provider passed by the caller (Upstox readiness)', () => {
    expect(classifyMarketDataProviderError(new Error('timeout'), 'UPSTOX')).toEqual({
      kind: 'NETWORK',
      provider: 'UPSTOX',
      retryable: true,
    });
  });

  test('isAuthExpiredError only accepts auth failures', () => {
    expect(isAuthExpiredError({ error_type: 'TokenException' })).toBe(true);
    expect(isAuthExpiredError({ statusCode: 429 })).toBe(false);
  });
});

describe('MarketDataUnavailableError', () => {
  test('is permanent so a scan does not burn its retry budget', () => {
    const err = new MarketDataUnavailableError('no connection');
    expect(err.code).toBe('MARKET_DATA_NOT_CONFIGURED');
    expect(err.permanent).toBe(true);
    expect(err.name).toBe('MarketDataUnavailableError');
  });
});

describe('normalizeProviderTimestamp', () => {
  test('treats a zone-less Kite wall clock as IST', () => {
    expect(normalizeProviderTimestamp('KITE', '2024-01-01 09:15:00')).toBe(
      '2024-01-01T03:45:00.000Z'
    );
  });

  test('preserves explicit offsets and rejects unusable input', () => {
    expect(normalizeProviderTimestamp('KITE', '2024-01-01T09:15:00+05:30')).toBe(
      '2024-01-01T03:45:00.000Z'
    );
    expect(normalizeProviderTimestamp('KITE', '')).toBeNull();
    expect(normalizeProviderTimestamp('KITE', 'not-a-date')).toBeNull();
  });

  test('returns null for providers without a normalizer yet', () => {
    expect(normalizeProviderTimestamp('UPSTOX', '2024-01-01 09:15:00')).toBeNull();
  });
});
