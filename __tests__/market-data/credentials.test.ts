/**
 * System market-data credential storage and resolution.
 *
 * Verifies:
 *  - active connections decrypt into a SYSTEM context,
 *  - ciphertext bound to another row is reported as ERROR (never silently
 *    ignored or downgraded to MISSING),
 *  - expired/revoked states short-circuit without a provider call,
 *  - the customer-session compatibility path obeys its policy and never
 *    overrides an ERROR,
 *  - saving re-encrypts with AAD derived from the stored connection id.
 */

process.env.KITE_TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const mockDb = {
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ query: string; values: unknown[] }>,
  inserts: [] as Array<{ query: string; values: unknown[] }>,
  selectRowsByCall: [] as Array<Array<Record<string, unknown>>>,
};

jest.mock('@/lib/db', () => ({
  getDb: () => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('?');
      if (query.includes('INSERT')) {
        mockDb.inserts.push({ query, values });
        return mockDb.selectRowsByCall.shift() ?? [{ connection_id: values[0] }];
      }
      if (query.includes('UPDATE')) {
        mockDb.updates.push({ query, values });
        if (query.includes('RETURNING')) {
          return mockDb.selectRowsByCall.shift() ?? [];
        }
        return [];
      }
      const scripted = mockDb.selectRowsByCall.shift();
      if (scripted) return scripted;
      return mockDb.rows;
    };
    return sql;
  },
}));

import type { KiteSession } from '@/lib/types';
import { decryptWithAad, encryptWithAad } from '@/lib/crypto';
import {
  allowsCustomerSessionFallback,
  getSystemMarketDataMetadata,
  loadSystemMarketDataConnection,
  marketDataAad,
  resolveMarketDataContext,
  revokeSystemMarketDataConnection,
  saveSystemMarketDataConnection,
} from '@/lib/market-data/credentials';
import { MarketDataUnavailableError } from '@/lib/market-data/errors';

const CONNECTION_ID = '11111111-2222-4333-8444-555555555555';
const EXPIRES = new Date(Date.now() + 6 * 3600_000);

const session: KiteSession = {
  accessToken: 'customer-token',
  userId: 'customer',
  userName: 'Customer',
  email: 'customer@example.com',
  loginTime: new Date().toISOString(),
  expiresAt: EXPIRES.toISOString(),
};

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    connection_id: CONNECTION_ID,
    provider: 'KITE',
    status: 'ACTIVE',
    encrypted_access_token: encryptWithAad(
      'system-token',
      marketDataAad('KITE', CONNECTION_ID, 'access')
    ),
    encrypted_refresh_token: encryptWithAad(
      'system-refresh',
      marketDataAad('KITE', CONNECTION_ID, 'refresh')
    ),
    token_expires_at: EXPIRES.toISOString(),
    provider_metadata: { api_key: 'system-app-key' },
    last_successful_use_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockDb.rows = [];
  mockDb.updates = [];
  mockDb.inserts = [];
  mockDb.selectRowsByCall = [];
  delete process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK;
});

describe('loadSystemMarketDataConnection', () => {
  test('returns a SYSTEM context with decrypted credentials', async () => {
    mockDb.rows = [activeRow()];

    const result = await loadSystemMarketDataConnection('KITE');

    expect(result.status).toBe('ACTIVE');
    if (result.status !== 'ACTIVE') throw new Error('expected ACTIVE');
    expect(result.connectionId).toBe(CONNECTION_ID);
    expect(result.apiKey).toBe('system-app-key');
    expect(result.context).toEqual({
      provider: 'KITE',
      credentials: {
        accessToken: 'system-token',
        apiKey: 'system-app-key',
        refreshToken: 'system-refresh',
      },
      source: 'SYSTEM',
      connectionId: CONNECTION_ID,
    });
  });

  test('reports a tampered/copied ciphertext as ERROR and marks the row', async () => {
    mockDb.rows = [
      activeRow({
        encrypted_access_token: encryptWithAad(
          'system-token',
          marketDataAad('KITE', 'some-other-connection', 'access')
        ),
      }),
    ];

    const result = await loadSystemMarketDataConnection('KITE');

    expect(result.status).toBe('ERROR');
    if (result.status !== 'ERROR') throw new Error('expected ERROR result');
    expect(result.message).not.toContain('system-token');
    expect(mockDb.updates).toHaveLength(1);
    expect(mockDb.updates[0].values).toContain('ERROR');
  });

  test('reports expired credentials and persists the transition', async () => {
    mockDb.rows = [activeRow({ token_expires_at: new Date(Date.now() - 1000).toISOString() })];

    const result = await loadSystemMarketDataConnection('KITE');

    expect(result.status).toBe('EXPIRED');
    expect(mockDb.updates[0].values).toContain('EXPIRED');
  });

  test('reports revoked and missing connections without decrypting', async () => {
    mockDb.rows = [activeRow({ status: 'REVOKED' })];
    expect((await loadSystemMarketDataConnection('KITE')).status).toBe('REVOKED');

    mockDb.rows = [];
    const missing = await loadSystemMarketDataConnection('KITE');
    expect(missing.status).toBe('MISSING');
    expect(missing.connectionId).toBeNull();
  });

  test('never returns ciphertext or tokens in safe metadata', async () => {
    mockDb.rows = [activeRow()];
    const metadata = await getSystemMarketDataMetadata('KITE');

    expect(metadata).toMatchObject({
      status: 'ACTIVE',
      provider: 'KITE',
      connectionId: CONNECTION_ID,
      apiKeyConfigured: true,
      refreshTokenConfigured: true,
    });
    expect(JSON.stringify(metadata)).not.toContain('system-token');
    expect(JSON.stringify(metadata)).not.toContain('system-app-key');
  });
});

describe('resolveMarketDataContext', () => {
  test('system credentials win over a customer session', async () => {
    mockDb.rows = [activeRow()];

    const context = await resolveMarketDataContext({ provider: 'KITE', session });

    expect(context.source).toBe('SYSTEM');
    expect(context.credentials.accessToken).toBe('system-token');
  });

  test('falls back to the customer session only when policy allows and no connection exists', async () => {
    mockDb.rows = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const context = await resolveMarketDataContext({
      provider: 'KITE',
      session,
      allowCustomerSessionFallback: true,
    });

    expect(context).toEqual({
      provider: 'KITE',
      credentials: { accessToken: 'customer-token' },
      source: 'CUSTOMER_SESSION_COMPAT',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('throws when no connection exists and fallback is disallowed', async () => {
    mockDb.rows = [];

    await expect(
      resolveMarketDataContext({
        provider: 'KITE',
        session,
        allowCustomerSessionFallback: false,
      })
    ).rejects.toBeInstanceOf(MarketDataUnavailableError);
  });

  test('never falls back when the system connection is in ERROR', async () => {
    mockDb.rows = [
      activeRow({
        encrypted_access_token: encryptWithAad(
          'system-token',
          marketDataAad('KITE', 'other-id', 'access')
        ),
      }),
    ];

    await expect(
      resolveMarketDataContext({
        provider: 'KITE',
        session,
        allowCustomerSessionFallback: true,
      })
    ).rejects.toBeInstanceOf(MarketDataUnavailableError);
  });

  test('fallback policy is disabled by default in production and overridable', () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    const setNodeEnv = (value: string) => {
      env.NODE_ENV = value;
    };

    setNodeEnv('production');
    expect(allowsCustomerSessionFallback()).toBe(false);
    process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK = 'true';
    expect(allowsCustomerSessionFallback()).toBe(true);
    delete process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK;
    process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK = 'false';
    expect(allowsCustomerSessionFallback()).toBe(false);

    setNodeEnv(original ?? 'test');
  });
});

describe('saveSystemMarketDataConnection', () => {
  test('updates an existing row and encrypts with its AAD', async () => {
    mockDb.selectRowsByCall = [[{ connection_id: CONNECTION_ID }]];

    const { connectionId } = await saveSystemMarketDataConnection({
      provider: 'KITE',
      accessToken: 'new-system-token',
      tokenExpiresAt: EXPIRES,
      apiKey: 'system-app-key',
    });

    expect(connectionId).toBe(CONNECTION_ID);
    expect(mockDb.inserts).toHaveLength(0);
    const values = mockDb.updates[0].values;
    const aad = marketDataAad('KITE', CONNECTION_ID, 'access');
    // Values: label, access ciphertext, refresh ciphertext, expires, metadata, id
    expect(decryptWithAad(String(values[1]), aad)).toBe('new-system-token');
  });

  test('inserts a new row whose ciphertext is bound to the generated id', async () => {
    mockDb.selectRowsByCall = [[], [{ connection_id: 'ignored' }]];

    const { connectionId } = await saveSystemMarketDataConnection({
      provider: 'KITE',
      accessToken: 'first-token',
    });

    expect(mockDb.inserts).toHaveLength(1);
    const values = mockDb.inserts[0].values;
    expect(values[0]).toBe(connectionId);
    const aad = marketDataAad('KITE', connectionId, 'access');
    expect(decryptWithAad(String(values[3]), aad)).toBe('first-token');
  });
});

describe('revokeSystemMarketDataConnection', () => {
  test('returns whether a system row was revoked', async () => {
    mockDb.selectRowsByCall = [[{ connection_id: CONNECTION_ID }]];
    expect(await revokeSystemMarketDataConnection('KITE')).toBe(true);
    mockDb.selectRowsByCall = [[]];
    expect(await revokeSystemMarketDataConnection('KITE')).toBe(false);
  });
});
