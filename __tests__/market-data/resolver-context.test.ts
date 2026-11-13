/**
 * Provider seam: instrument-key resolution, context conversion and registry.
 *
 * Kite's canonical instrument id is its provider token, so resolution is local.
 * Any other provider must resolve through instrument_aliases and never invents
 * a key.
 */

const mockAliasRows: Array<Array<Record<string, unknown>>> = [];
const mockCalls: string[] = [];

jest.mock('@/lib/db', () => ({
  getDb: () => {
    const sql = async (strings: TemplateStringsArray) => {
      mockCalls.push(strings.join('?'));
      return mockAliasRows.shift() ?? [];
    };
    return sql;
  },
}));

import type { KiteSession } from '@/lib/types';
import {
  contextFromKiteSession,
  isKiteSession,
  isMarketDataContext,
  toMarketDataContext,
} from '@/lib/market-data/context';
import { MarketDataUnavailableError } from '@/lib/market-data/errors';
import { resolveProviderInstrumentKey } from '@/lib/market-data/instrument-resolver';
import {
  getMarketDataProvider,
  isMarketDataProviderImplemented,
} from '@/lib/market-data/provider';

const session: KiteSession = {
  accessToken: 'token',
  userId: 'user',
  userName: 'User',
  email: 'u@example.com',
  loginTime: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

beforeEach(() => {
  mockAliasRows.length = 0;
  mockCalls.length = 0;
});

describe('resolveProviderInstrumentKey', () => {
  test('returns the canonical id for Kite without touching the database', async () => {
    expect(await resolveProviderInstrumentKey('KITE', 408065)).toBe('408065');
    expect(mockCalls).toHaveLength(0);
  });

  test('resolves another provider through instrument_aliases', async () => {
    mockAliasRows.push([{ provider_instrument_key: 'NSE_EQ|INE009A01021' }]);
    expect(await resolveProviderInstrumentKey('UPSTOX', 408065)).toBe(
      'NSE_EQ|INE009A01021'
    );
    expect(mockCalls[0]).toContain('FROM instrument_aliases');
  });

  test('throws when no alias exists instead of guessing', async () => {
    mockAliasRows.push([]);
    await expect(resolveProviderInstrumentKey('UPSTOX', 408065)).rejects.toThrow(
      /No UPSTOX instrument alias/
    );
  });
});

describe('market-data context guards', () => {
  const context = {
    provider: 'KITE' as const,
    credentials: { accessToken: 'system-token' },
    source: 'SYSTEM' as const,
    connectionId: 'conn-1',
  };

  test('distinguishes a resolved context from a raw Kite session', () => {
    expect(isMarketDataContext(context)).toBe(true);
    expect(isKiteSession(context)).toBe(false);
    expect(isKiteSession(session)).toBe(true);
    expect(isMarketDataContext(session)).toBe(false);
    expect(isMarketDataContext(null)).toBe(false);
  });

  test('wraps a customer session as a compatibility context without an api key', () => {
    expect(contextFromKiteSession(session)).toEqual({
      provider: 'KITE',
      credentials: { accessToken: 'token' },
      source: 'CUSTOMER_SESSION_COMPAT',
    });
  });

  test('toMarketDataContext passes a resolved context through unchanged', () => {
    expect(toMarketDataContext(context)).toBe(context);
    expect(toMarketDataContext(session).source).toBe('CUSTOMER_SESSION_COMPAT');
  });
});

describe('provider registry', () => {
  test('exposes the Kite adapter', () => {
    expect(isMarketDataProviderImplemented('KITE')).toBe(true);
    expect(getMarketDataProvider('KITE').name).toBe('KITE');
  });

  test('reports Upstox as unimplemented instead of returning a broken adapter', () => {
    expect(isMarketDataProviderImplemented('UPSTOX')).toBe(false);
    expect(() => getMarketDataProvider('UPSTOX')).toThrow(MarketDataUnavailableError);
  });
});
