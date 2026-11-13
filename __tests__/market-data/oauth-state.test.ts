/**
 * Single-use OAuth state for the operator system-connection flow.
 *
 * The plaintext never reaches the database; only its SHA-256 hash is stored and
 * consumption is a single atomic UPDATE, so a replayed callback cannot be
 * accepted.
 */

const mockDb = {
  insertRows: [] as Array<Record<string, unknown>>,
  consumeRows: [] as Array<Record<string, unknown>>,
  cleanupRows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ query: string; values: unknown[] }>,
};

jest.mock('@/lib/db', () => ({
  getDb: () => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('?');
      mockDb.calls.push({ query, values });
      if (query.includes('INSERT INTO market_data_oauth_states')) return mockDb.insertRows;
      if (query.includes('SET consumed_at')) return mockDb.consumeRows;
      if (query.includes('DELETE FROM market_data_oauth_states')) return mockDb.cleanupRows;
      return [];
    };
    return sql;
  },
}));

import {
  OAUTH_STATE_TTL_MS,
  cleanupExpiredOAuthStates,
  consumeOAuthState,
  createOAuthState,
  hashOAuthState,
  oauthStateMatches,
  persistOAuthState,
} from '@/lib/market-data/oauth-state';

beforeEach(() => {
  mockDb.insertRows = [{ state_hash: 'x' }];
  mockDb.consumeRows = [{ state_hash: 'x' }];
  mockDb.cleanupRows = [];
  mockDb.calls = [];
});

describe('createOAuthState / hashOAuthState', () => {
  test('creates 256-bit random hex values', () => {
    const a = createOAuthState();
    const b = createOAuthState();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
  });

  test('stores only a 64-character hash, never the plaintext', async () => {
    const state = createOAuthState();
    await persistOAuthState({ state, provider: 'KITE' });

    const { query, values } = mockDb.calls[0];
    expect(query).toContain('INSERT INTO market_data_oauth_states');
    expect(values[0]).toBe(hashOAuthState(state));
    expect(values[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(values).not.toContain(state);
    expect(values).toContain('KITE');
    expect(values).toContain(OAUTH_STATE_TTL_MS);
  });

  test('fails when a hash collision prevented the insert', async () => {
    mockDb.insertRows = [];
    await expect(
      persistOAuthState({ state: createOAuthState(), provider: 'KITE' })
    ).rejects.toThrow(/unique OAuth state/);
  });
});

describe('oauthStateMatches', () => {
  const state = 'a'.repeat(64);

  test('matches equal values only', () => {
    expect(oauthStateMatches(state, state)).toBe(true);
    expect(oauthStateMatches(state, 'b'.repeat(64))).toBe(false);
    expect(oauthStateMatches(null, state)).toBe(false);
    expect(oauthStateMatches(state, null)).toBe(false);
  });
});

describe('consumeOAuthState', () => {
  test('consumes an unknown/expired/replayed state at most once', async () => {
    expect(await consumeOAuthState({ state: 'x'.repeat(64), provider: 'KITE' })).toBe(true);
    const { query, values } = mockDb.calls[0];
    expect(query).toContain('consumed_at IS NULL');
    expect(query).toContain('expires_at > NOW()');
    expect(values).toContain('KITE');

    mockDb.consumeRows = [];
    expect(await consumeOAuthState({ state: 'x'.repeat(64), provider: 'KITE' })).toBe(false);
  });
});

describe('cleanupExpiredOAuthStates', () => {
  test('deletes only expired rows and reports the count', async () => {
    mockDb.cleanupRows = [{ state_hash: 'a' }, { state_hash: 'b' }];
    expect(await cleanupExpiredOAuthStates()).toBe(2);
    expect(mockDb.calls[0].query).toContain('expires_at < NOW()');
  });
});
