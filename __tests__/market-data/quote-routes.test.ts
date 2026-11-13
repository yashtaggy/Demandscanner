/**
 * Shared quote route isolation.
 *
 * The stock dashboard and the generic quote endpoint must read market data with
 * the SYSTEM connection. A customer's Kite token is used only through the
 * explicit compatibility path, and never when the system credential is present
 * or in an ERROR state.
 */

process.env.KITE_TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

jest.mock('next/server', () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers ?? {}),
      json: async () => body,
    }),
  },
}));

const mockDb = { rows: [] as Array<Record<string, unknown>> };

jest.mock('@/lib/db', () => ({
  getDb: () => async (strings: TemplateStringsArray) => {
    const query = strings.join('?');
    if (query.includes('UPDATE')) return [];
    return mockDb.rows;
  },
}));

jest.mock('@/lib/kite-session', () => ({
  getSessionFromRequest: jest.fn(),
}));

jest.mock('@/lib/subscriptions/entitlements', () => ({
  requireActiveSubscription: jest.fn(),
}));

jest.mock('@/lib/kite-client', () => ({
  getQuotes: jest.fn(),
  getNSEInstruments: jest.fn(),
  buildStockRow: jest.fn(),
}));

import type { NextRequest } from 'next/server';
import type { KiteSession } from '@/lib/types';
import { encryptWithAad } from '@/lib/crypto';
import { marketDataAad } from '@/lib/market-data/credentials';
import { getSessionFromRequest } from '@/lib/kite-session';
import { requireActiveSubscription } from '@/lib/subscriptions/entitlements';
import { AppAuthError } from '@/lib/auth/types';
import { getQuotes } from '@/lib/kite-client';
import { GET as getQuoteRoute } from '@/app/api/kite/quote/route';

const CONNECTION_ID = '11111111-2222-4333-8444-555555555555';

const customerSession: KiteSession = {
  accessToken: 'customer-token',
  userId: 'customer',
  userName: 'Customer',
  email: 'customer@example.com',
  loginTime: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function systemRow() {
  return {
    connection_id: CONNECTION_ID,
    provider: 'KITE',
    status: 'ACTIVE',
    encrypted_access_token: encryptWithAad(
      'system-token',
      marketDataAad('KITE', CONNECTION_ID, 'access')
    ),
    encrypted_refresh_token: null,
    token_expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
    provider_metadata: { api_key: 'system-app-key' },
  };
}

function request(url = 'http://localhost/api/kite/quote?symbol=NSE:INFY') {
  return { url, headers: new Headers(), cookies: { get: () => undefined } } as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.rows = [];
  delete process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK;
  (requireActiveSubscription as jest.Mock).mockResolvedValue({
    user: {
      userId: '00000000-0000-4000-8000-000000000001',
      email: 'customer@example.com',
      displayName: 'Customer',
      status: 'ACTIVE',
      role: 'CUSTOMER',
    },
    subscription: { entitled: true, today: '2026-11-13', current: null, history: [] },
  });
  (getSessionFromRequest as jest.Mock).mockResolvedValue(customerSession);
  (getQuotes as jest.Mock).mockResolvedValue(
    new Map([['NSE:INFY', { lastPrice: 100, timestamp: '2024-01-01T03:45:00.000Z' }]])
  );
});

describe('/api/kite/quote market-data isolation', () => {
  test('uses the system connection and its application key when configured', async () => {
    mockDb.rows = [systemRow()];

    const response = (await getQuoteRoute(request())) as unknown as {
      status: number;
      json: () => Promise<{ ok: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(getQuotes).toHaveBeenCalledWith('system-token', ['NSE:INFY'], 'system-app-key');
  });

  test('falls back to the customer session only when policy explicitly allows it', async () => {
    mockDb.rows = [];
    process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK = 'true';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const response = (await getQuoteRoute(request())) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(getQuotes).toHaveBeenCalledWith('customer-token', ['NSE:INFY'], undefined);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('returns 503 without a provider call when the system connection is missing', async () => {
    mockDb.rows = [];
    process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK = 'false';

    const response = (await getQuoteRoute(request())) as unknown as {
      status: number;
      json: () => Promise<{ code: string }>;
    };

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('MARKET_DATA_NOT_CONFIGURED');
    expect(getQuotes).not.toHaveBeenCalled();
  });

  test('never falls back after a decryption failure', async () => {
    mockDb.rows = [
      {
        ...systemRow(),
        encrypted_access_token: encryptWithAad(
          'system-token',
          marketDataAad('KITE', 'another-connection', 'access')
        ),
      },
    ];
    process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK = 'true';

    const response = (await getQuoteRoute(request())) as unknown as { status: number };

    expect(response.status).toBe(503);
    expect(getQuotes).not.toHaveBeenCalled();
  });

  test('still requires an authenticated customer (no unauthenticated quote access)', async () => {
    (requireActiveSubscription as jest.Mock).mockRejectedValue(new AppAuthError('UNAUTHENTICATED'));
    mockDb.rows = [systemRow()];

    const response = (await getQuoteRoute(request())) as unknown as { status: number };

    expect(response.status).toBe(401);
    expect(getQuotes).not.toHaveBeenCalled();
  });
});
