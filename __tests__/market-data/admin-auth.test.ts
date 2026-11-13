/**
 * Operator authentication for system market-data administration.
 *
 * Temporary header-based gate, deliberately separate from customer sessions.
 * It must fail closed when unconfigured and never echo the expected token.
 */

import {
  MARKET_DATA_ADMIN_HEADER,
  isMarketDataAdminConfigured,
  verifyMarketDataAdminToken,
} from '@/lib/market-data/admin-auth';

const TOKEN = 'operator-secret-token';

beforeEach(() => {
  delete process.env.MARKET_DATA_ADMIN_TOKEN;
});

describe('verifyMarketDataAdminToken', () => {
  test('fails closed when administration is not configured', () => {
    expect(isMarketDataAdminConfigured()).toBe(false);
    expect(verifyMarketDataAdminToken(TOKEN)).toMatchObject({
      ok: false,
      status: 503,
      code: 'ADMIN_AUTH_NOT_CONFIGURED',
    });
  });

  test('requires a token when configured', () => {
    process.env.MARKET_DATA_ADMIN_TOKEN = TOKEN;
    expect(isMarketDataAdminConfigured()).toBe(true);
    expect(verifyMarketDataAdminToken(null)).toMatchObject({
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  test('accepts the configured token and rejects everything else', () => {
    process.env.MARKET_DATA_ADMIN_TOKEN = TOKEN;
    expect(verifyMarketDataAdminToken(TOKEN)).toEqual({ ok: true });
    expect(verifyMarketDataAdminToken('wrong')).toMatchObject({ ok: false, status: 401 });
    // Different lengths must not throw from a constant-time comparison.
    expect(verifyMarketDataAdminToken('x'.repeat(1000))).toMatchObject({ ok: false });
  });

  test('advertises a dedicated header name', () => {
    expect(MARKET_DATA_ADMIN_HEADER).toBe('x-market-data-admin-token');
  });
});
