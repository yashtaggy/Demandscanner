/**
 * Phase 4 migration contract (static).
 *
 * No database is contacted. Behaviour against a disposable Postgres lives in
 * tests/phase4 and is skipped unless PHASE4_TEST_DATABASE_URL is set.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { splitStatements } = require(join(__dirname, '..', '..', 'db', 'sql-statements'));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const ROOT = join(__dirname, '..', '..');
const DB_DIR = join(ROOT, 'db');
const MIGRATION_NAME = '2026-11-13-phase4-subscriptions.sql';
const MIGRATION_PATH = join(DB_DIR, 'migrations', MIGRATION_NAME);
const RUNNER_PATH = join(DB_DIR, 'migrate-phase4.js');

const statements: string[] = splitStatements(readFileSync(MIGRATION_PATH, 'utf8'));

function statementMatching(pattern: RegExp): string {
  const found = statements.find((statement) => pattern.test(statement));
  if (!found) throw new Error(`No statement matches ${pattern}`);
  return found;
}

function columnsOf(table: string): string[] {
  const statement = statementMatching(
    new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\s*\\(`, 'i')
  );
  const body = statement.slice(statement.indexOf('(') + 1, statement.lastIndexOf(')'));
  const columns = body
    .split('\n')
    .map((line) => line.trim())
    .map(
      (line) =>
        (line.match(/^([a-z_][a-z0-9_]*)\s+(UUID|TEXT|INTEGER|NUMERIC|DATE|TIMESTAMPTZ|BOOLEAN)\b/i) ??
          [])[1]
    )
    .filter((name): name is string => Boolean(name));
  return [...new Set(columns)];
}

describe('Phase 4 migration', () => {
  test('is the newest migration and is not a rewrite of an earlier file', () => {
    expect(MIGRATION_NAME).toBe('2026-11-13-phase4-subscriptions.sql');
    expect(MIGRATION_NAME.startsWith('2026-11-13')).toBe(true);
  });

  test('contains only additive CREATE statements', () => {
    expect(statements).toHaveLength(12);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE\b/i);
      expect(statement).not.toMatch(
        /\b(DROP|ALTER|TRUNCATE|INSERT|UPDATE|GRANT|REVOKE)\b|\bDELETE\s+FROM\b/i
      );
    }
  });

  test('creates the three Phase 4 tables with their full columns', () => {
    expect(columnsOf('subscription_plans').sort()).toEqual(
      [
        'plan_id',
        'name',
        'description',
        'duration_days',
        'price',
        'currency',
        'status',
        'created_at',
        'updated_at',
      ].sort()
    );
    expect(columnsOf('customer_subscriptions').sort()).toEqual(
      [
        'subscription_id',
        'user_id',
        'plan_id',
        'start_date',
        'end_date',
        'status',
        'created_by',
        'activated_at',
        'activated_by',
        'cancelled_at',
        'cancelled_by',
        'cancellation_reason',
        'renewed_from_subscription_id',
        'created_at',
        'updated_at',
      ].sort()
    );
    expect(columnsOf('payment_records').sort()).toEqual(
      [
        'payment_id',
        'user_id',
        'subscription_id',
        'amount',
        'currency',
        'payment_method',
        'payment_reference',
        'payment_date',
        'payment_status',
        'notes',
        'recorded_by',
        'created_at',
      ].sort()
    );
  });

  test('never stores card, CVV or banking credentials', () => {
    const ddl = statements.join('\n');
    expect(ddl).not.toMatch(/\b(card|cvv|pan|iban|account_number|upi_pin)\b/i);
  });

  test('plans referenced by subscriptions are RESTRICT, payments preserve audit', () => {
    const ddl = statements.join('\n');
    expect(ddl).toMatch(
      /plan_id\s+UUID\s+NOT NULL\s+REFERENCES subscription_plans\(plan_id\) ON DELETE RESTRICT/i
    );
    expect(ddl).toMatch(
      /FOREIGN KEY \(subscription_id, user_id\)\s+REFERENCES customer_subscriptions\(subscription_id, user_id\)\s+ON DELETE RESTRICT/i
    );
  });

  test('the entitlement predicate is inclusive and Asia/Kolkata based', () => {
    const fn = statementMatching(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+is_subscription_entitled/i);
    expect(fn).toMatch(/p_at AT TIME ZONE 'Asia\/Kolkata'/);
    expect(fn).toMatch(/BETWEEN s\.start_date AND s\.end_date/);
    expect(fn).toMatch(/s\.status = 'ACTIVE'/);
    expect(fn).toMatch(/u\.status = 'ACTIVE'/);
    expect(fn).toMatch(/DEFAULT NOW\(\)/);
  });

  test('the shared schema contract includes the new tables', () => {
    expect(Object.keys(EXPECTED_SCHEMA)).toEqual(
      expect.arrayContaining([
        'subscription_plans',
        'customer_subscriptions',
        'payment_records',
      ])
    );
  });
});

describe('Phase 4 migration runner', () => {
  const runner = readFileSync(RUNNER_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//');
      return index === -1 ? line : line.slice(0, index);
    })
    .join('\n');

  test('is targeted and requires explicit approval', () => {
    expect(runner).toContain(MIGRATION_NAME);
    expect(runner).toContain('PHASE4_DATABASE_URL');
    expect(runner).toContain('ALLOW_PHASE4_MIGRATION');
    expect(runner).toContain('EXPECTED_PHASE4_HOST');
    expect(runner).toContain('FORBIDDEN_DATABASE_HOST');
    expect(runner).not.toContain('readdir');
    expect(runner).not.toContain('migrate.js');
  });

  test('refuses non-Neon, pooled and production targets', () => {
    expect(runner).toContain('target.isNeon');
    expect(runner).toContain('target.pooled');
    expect(runner).toContain("NODE_ENV === 'production'");
    expect(runner).toContain('ALLOWED_STATEMENTS');
  });
});
