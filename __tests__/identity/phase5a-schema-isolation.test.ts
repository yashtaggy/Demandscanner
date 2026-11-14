/**
 * Phase 5A contract isolation regression.
 *
 * Phase 5A initializes and verifies the pre-Signals schema only. A database
 * that Phase 5A fully initialized must remain valid even though the complete
 * application contract now also requires Signals. The full contract must still
 * report Signals as missing on such a database.
 *
 * No database is contacted.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const contract = require(join(__dirname, '..', '..', 'db', 'expected-schema'));
const {
  EXPECTED_SCHEMA,
  PHASE5A_EXPECTED_SCHEMA,
  POST_PHASE5A_TABLES,
} = contract;

const ROOT = join(__dirname, '..', '..');

const FULL = EXPECTED_SCHEMA as Record<string, string[]>;
const PHASE5A = PHASE5A_EXPECTED_SCHEMA as Record<string, string[]>;
const POST_PHASE5A = POST_PHASE5A_TABLES as string[];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//');
      return index === -1 ? line : line.slice(0, index);
    })
    .join('\n');
}

const RUNNER = stripComments(
  readFileSync(join(ROOT, 'db', 'migrate-phase5a.js'), 'utf8')
);
const VERIFY = stripComments(
  readFileSync(join(ROOT, 'db', 'verify-schema.js'), 'utf8')
);
const SIGNALS_RUNNER = stripComments(
  readFileSync(join(ROOT, 'db', 'migrate-signals.js'), 'utf8')
);

function missingTables(
  expected: Record<string, string[]>,
  actualTables: string[]
): string[] {
  return Object.keys(expected).filter((table) => !actualTables.includes(table));
}

describe('Phase 5A schema contract isolation', () => {
  test('the complete application contract still includes Signals', () => {
    expect(Object.keys(FULL)).toEqual(
      expect.arrayContaining([
        'signals',
        'signal_recipients',
        'signal_email_attempts',
      ])
    );
    expect([...POST_PHASE5A].sort()).toEqual(
      ['signals', 'signal_recipients', 'signal_email_attempts'].sort()
    );
  });

  test('the Phase 5A contract excludes only the post-Phase-5A tables', () => {
    const expectedPhase5aTables = Object.keys(FULL)
      .filter((table) => !POST_PHASE5A.includes(table))
      .sort();

    expect(Object.keys(PHASE5A).sort()).toEqual(expectedPhase5aTables);
    for (const table of POST_PHASE5A) {
      expect(PHASE5A[table]).toBeUndefined();
      expect(FULL[table]).toBeDefined();
    }
  });

  test('Phase 5A-owned tables and columns are unchanged by the split', () => {
    for (const table of Object.keys(PHASE5A)) {
      expect({ table, columns: PHASE5A[table] }).toEqual({
        table,
        columns: FULL[table],
      });
    }
    // Representative Phase 5A objects remain required.
    for (const table of [
      'app_users',
      'customer_subscriptions',
      'payment_records',
      'live_trade_groups',
      'live_trade_items',
      'live_trade_quote_state',
    ]) {
      expect(PHASE5A[table]).toBeDefined();
    }
  });

  test('a Phase 5A-only schema has no missing Phase 5A tables', () => {
    const phase5aOnlyTables = Object.keys(PHASE5A);
    expect(missingTables(PHASE5A, phase5aOnlyTables)).toEqual([]);
  });

  test('the full contract still detects every missing Signals table', () => {
    const phase5aOnlyTables = Object.keys(PHASE5A);
    expect(missingTables(FULL, phase5aOnlyTables).sort()).toEqual(
      [...POST_PHASE5A].sort()
    );
  });

  test('the Phase 5A runner verifies against the isolated contract', () => {
    expect(RUNNER).toContain('PHASE5A_EXPECTED_SCHEMA');
    expect(RUNNER).toContain(
      'Object.entries(PHASE5A_EXPECTED_SCHEMA)'
    );
    expect(RUNNER).toContain(
      'Object.keys(PHASE5A_EXPECTED_SCHEMA).sort()'
    );
    expect(RUNNER).toMatch(/ownedTables/);
  });

  test('the Phase 5A runner still rejects unknown tables using the full contract', () => {
    expect(RUNNER).toContain(
      'const knownTables = new Set(Object.keys(EXPECTED_SCHEMA));'
    );
    expect(RUNNER).toContain('!knownTables.has(name)');
    expect(RUNNER).toContain(
      'const knownTables = Object.keys(EXPECTED_SCHEMA).sort();'
    );
    expect(RUNNER).toContain('!knownTables.includes(name)');
  });

  test('the Phase 5A runner has no Signals-specific verification logic', () => {
    expect(RUNNER).not.toMatch(
      /signal_recipients|signal_email_attempts|signals_created|signals_message/i
    );
  });

  test('the complete schema verifier still uses the full contract', () => {
    expect(VERIFY).toContain('const { EXPECTED_SCHEMA }');
    expect(VERIFY).not.toContain('PHASE5A_EXPECTED_SCHEMA');
    expect(VERIFY).toContain('Object.entries(EXPECTED_SCHEMA)');
  });

  test('the Signals runner still verifies all three Signals tables', () => {
    expect(SIGNALS_RUNNER).toContain(
      "const TABLES = ['signals', 'signal_recipients', 'signal_email_attempts'];"
    );
    expect(SIGNALS_RUNNER).toContain('EXPECTED_SCHEMA[table]');
  });
});
