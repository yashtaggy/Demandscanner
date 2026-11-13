/**
 * Phase 4 subscription lifecycle and IST expiry behaviour.
 *
 * Runs only when PHASE4_TEST_DATABASE_URL points at a DISPOSABLE local/test
 * Postgres database. Without it the suite is skipped. The application's
 * DATABASE_URL is never read and no Neon development database is touched.
 *
 * The ordered chain is applied here directly with psql — the broad db:migrate
 * runner and db/migrate-phase4.js are not used.
 */

import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const DB_DIR = join(__dirname, '..', '..', 'db');
const MIGRATIONS_DIR = join(DB_DIR, 'migrations');
const PHASE4_MIGRATION = '2026-11-13-phase4-subscriptions.sql';

const TEST_URL = process.env.PHASE4_TEST_DATABASE_URL?.trim();
const PSQL = process.env.PHASE4_PSQL_BIN?.trim() || 'psql';

/** Dependency order, not filename order. */
const CHAIN_ORDER = [
  '2024-10-18-add-aggregation-schema.sql',
  '2024-10-18-add-scanner-schema.sql',
  '2024-10-18-v1-intraday-scoring-history.sql',
  '2026-10-20-add-scan-batch-checkpoints.sql',
  '2026-11-12-add-internal-identity-foundation.sql',
  '2026-11-12-add-phase1-5-broker-market-data.sql',
  '2026-11-12-add-phase2-firebase-auth.sql',
  '2026-11-06-add-live-trade.sql',
  '2026-11-09-live-trade-allow-repeat-instruments.sql',
  '2026-11-13-live-trade-internal-ownership.sql',
  '2026-11-13-phase4-subscriptions.sql',
];

jest.setTimeout(120_000);

function run(sql: string): string {
  if (!TEST_URL) throw new Error('PHASE4_TEST_DATABASE_URL is not set');
  return execFileSync(
    PSQL,
    [TEST_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  ).trim();
}

function runFile(filePath: string): void {
  if (!TEST_URL) throw new Error('PHASE4_TEST_DATABASE_URL is not set');
  execFileSync(PSQL, [TEST_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', filePath], {
    encoding: 'utf8',
  });
}

function failureMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (stderr) return String(stderr);
  }
  return error instanceof Error ? error.message : String(error);
}

function expectFailure(sql: string): string {
  try {
    run(sql);
  } catch (error) {
    return failureMessage(error);
  }
  throw new Error('Expected the statement to fail, but it succeeded.');
}

const describeDb = TEST_URL ? describe : describe.skip;

describeDb('Phase 4 subscriptions (disposable database)', () => {
  const runId = randomUUID().replace(/-/g, '');
  const emailBase = `phase4-${runId}`;
  let userActive = '';
  let userSuspended = '';
  let userDisabled = '';
  let otherUser = '';
  let planMonthly = '';
  let planAnnual = '';
  let subEndingNewYear = '';
  let subOther = '';

  beforeAll(() => {
    runFile(join(DB_DIR, 'schema.sql'));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect([...CHAIN_ORDER].sort()).toEqual(files);
    for (const file of CHAIN_ORDER) runFile(join(MIGRATIONS_DIR, file));

    userActive = run(
      `INSERT INTO app_users (email, display_name, status)
       VALUES ('${emailBase}-active@example.com', 'Phase 4 Active', 'ACTIVE')
       RETURNING user_id;`
    );
    userSuspended = run(
      `INSERT INTO app_users (email, display_name, status)
       VALUES ('${emailBase}-suspended@example.com', 'Phase 4 Suspended', 'SUSPENDED')
       RETURNING user_id;`
    );
    userDisabled = run(
      `INSERT INTO app_users (email, display_name, status)
       VALUES ('${emailBase}-disabled@example.com', 'Phase 4 Disabled', 'DISABLED')
       RETURNING user_id;`
    );
    otherUser = run(
      `INSERT INTO app_users (email, display_name)
       VALUES ('${emailBase}-other@example.com', 'Phase 4 Other')
       RETURNING user_id;`
    );

    planMonthly = run(
      `INSERT INTO subscription_plans (name, duration_days, price, currency)
       VALUES ('Phase 4 Monthly ${runId}', 30, 499.00, 'INR')
       RETURNING plan_id;`
    );
    planAnnual = run(
      `INSERT INTO subscription_plans (name, duration_days, price, currency)
       VALUES ('Phase 4 Annual ${runId}', 365, 4999.00, 'INR')
       RETURNING plan_id;`
    );

    subEndingNewYear = run(
      `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status, activated_at)
       VALUES ('${userActive}', '${planMonthly}', DATE '2026-12-01', DATE '2026-12-31',
               'ACTIVE', NOW())
       RETURNING subscription_id;`
    );
    subOther = run(
      `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status, activated_at)
       VALUES ('${otherUser}', '${planMonthly}', DATE '2026-11-01', DATE '2026-11-30',
               'ACTIVE', NOW())
       RETURNING subscription_id;`
    );
  });

  afterAll(() => {
    if (!TEST_URL) return;
    run(`DELETE FROM app_users WHERE lower(email) LIKE '${emailBase}%';`);
    run(`DELETE FROM subscription_plans WHERE name LIKE 'Phase 4 % ${runId}';`);
  });

  test('reapplying the Phase 4 migration is idempotent', () => {
    runFile(join(MIGRATIONS_DIR, PHASE4_MIGRATION));
    expect(
      run(
        `SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'subscription_plans';`
      )
    ).toBe(String(EXPECTED_SCHEMA.subscription_plans.length));
  });

  test('the resulting schema contains every column the application expects', () => {
    for (const table of ['subscription_plans', 'customer_subscriptions', 'payment_records']) {
      const actual = run(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table}';`
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const missing = (EXPECTED_SCHEMA as Record<string, string[]>)[table].filter(
        (column) => !actual.includes(column)
      );
      expect({ table, missing }).toEqual({ table, missing: [] });
    }
  });

  test('a subscription ending 2026-12-31 is valid through 23:59:59 IST', () => {
    // 2026-12-31 23:59:59 Asia/Kolkata is 2026-12-31 18:29:59 UTC.
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2026-12-31 18:29:59+00'
         );`
      )
    ).toBe('t');
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2026-12-01 00:00:00+05:30'
         );`
      )
    ).toBe('t');
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2026-11-30 23:59:59+05:30'
         );`
      )
    ).toBe('f');
  });

  test('the same subscription is denied at 00:00 IST on 2027-01-01', () => {
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2026-12-31 18:30:00+00'
         );`
      )
    ).toBe('f');
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2027-01-01 00:00:00+05:30'
         );`
      )
    ).toBe('f');
  });

  test('suspension blocks access immediately without touching subscription dates', () => {
    const before = run(
      `SELECT start_date || '|' || end_date FROM customer_subscriptions
        WHERE subscription_id = '${subEndingNewYear}';`
    );
    run(`UPDATE app_users SET status = 'SUSPENDED' WHERE user_id = '${userActive}';`);

    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('f');

    run(`UPDATE app_users SET status = 'DISABLED' WHERE user_id = '${userActive}';`);
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('f');

    run(`UPDATE app_users SET status = 'ACTIVE' WHERE user_id = '${userActive}';`);
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userActive}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('t');
    expect(
      run(
        `SELECT start_date || '|' || end_date FROM customer_subscriptions
          WHERE subscription_id = '${subEndingNewYear}';`
      )
    ).toBe(before);
  });

  test('PENDING, CANCELLED and EXPIRED subscriptions never grant access', () => {
    const pending = run(
      `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status)
       VALUES ('${otherUser}', '${planAnnual}', DATE '2026-12-01', DATE '2027-12-01', 'PENDING')
       RETURNING subscription_id;`
    );
    // The earlier ACTIVE subscription ended 2026-11-30; PENDING grants nothing.
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${otherUser}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('f');

    run(`UPDATE customer_subscriptions SET status = 'CANCELLED',
           cancelled_at = NOW(), cancellation_reason = 'Phase 4 cancellation check'::text
         WHERE user_id = '${otherUser}' AND status = 'ACTIVE';`);
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${otherUser}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('f');

    run(`UPDATE customer_subscriptions SET status = 'ACTIVE' WHERE subscription_id = '${pending}';`);
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${otherUser}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('t');

    run(`UPDATE customer_subscriptions SET status = 'EXPIRED' WHERE subscription_id = '${pending}';`);
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${otherUser}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('f');
  });

  test('the entitlement predicate defaults to NOW() in Asia/Kolkata', () => {
    const definition = run(
      `SELECT pg_get_functiondef(p.oid)
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'is_subscription_entitled';`
    );
    expect(definition).toMatch(/DEFAULT NOW\(\)/i);
    expect(definition).toMatch(/Asia\/Kolkata/);
  });

  test('plan names are unique case-insensitively', () => {
    const duplicate = expectFailure(
      `INSERT INTO subscription_plans (name, duration_days, price, currency)
       VALUES ('  phase 4 monthly ${runId}  ', 30, 0, 'INR');`
    );
    expect(duplicate).toMatch(/subscription_plans_name_lower_uq|duplicate key/i);
  });

  test('plan values are validated', () => {
    expect(
      expectFailure(
        `INSERT INTO subscription_plans (name, duration_days, price, currency)
         VALUES ('Bad duration ${runId}', 0, 0, 'INR');`
      )
    ).toMatch(/subscription_plans_duration_chk/);
    expect(
      expectFailure(
        `INSERT INTO subscription_plans (name, duration_days, price, currency)
         VALUES ('Bad price ${runId}', 30, -1, 'INR');`
      )
    ).toMatch(/subscription_plans_price_chk/);
    expect(
      expectFailure(
        `INSERT INTO subscription_plans (name, duration_days, price, currency)
         VALUES ('Bad currency ${runId}', 30, 0, 'rupees');`
      )
    ).toMatch(/subscription_plans_currency_chk/);
    expect(
      expectFailure(
        `INSERT INTO subscription_plans (name, duration_days, price, currency, status)
         VALUES ('Bad status ${runId}', 30, 0, 'INR', 'RETIRED');`
      )
    ).toMatch(/subscription_plans_status_chk/);
  });

  test('subscription dates and statuses are validated', () => {
    expect(
      expectFailure(
        `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status)
         VALUES ('${userActive}', '${planMonthly}', DATE '2026-12-31', DATE '2026-12-01', 'PENDING');`
      )
    ).toMatch(/customer_subscriptions_dates_chk/);
    expect(
      expectFailure(
        `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status)
         VALUES ('${userActive}', '${planMonthly}', DATE '2026-12-01', DATE '2026-12-31', 'UNKNOWN');`
      )
    ).toMatch(/customer_subscriptions_status_chk/);
    expect(
      expectFailure(
        `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status)
         VALUES ('${userActive}', '${planMonthly}', DATE '2026-12-01', DATE '2026-12-31', 'CANCELLED');`
      )
    ).toMatch(/customer_subscriptions_cancellation_chk/);
    expect(
      expectFailure(
        `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status)
         VALUES ('${randomUUID()}', '${planMonthly}', DATE '2026-12-01', DATE '2026-12-31', 'PENDING');`
      )
    ).toMatch(/customer_subscriptions_user_id_fkey|foreign key/i);
  });

  test('a subscription can also be recorded for a suspended account', () => {
    const row = run(
      `INSERT INTO customer_subscriptions (user_id, plan_id, start_date, end_date, status)
       VALUES ('${userSuspended}', '${planMonthly}', DATE '2026-12-01', DATE '2026-12-31', 'ACTIVE')
       RETURNING subscription_id;`
    );
    expect(row).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userSuspended}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('f');
    expect(
      run(
        `SELECT is_subscription_entitled(
           '${userDisabled}', TIMESTAMPTZ '2026-12-15 10:00:00+05:30'
         );`
      )
    ).toBe('f');
  });

  test('payments validate amounts, currency and method', () => {
    expect(
      expectFailure(
        `INSERT INTO payment_records (user_id, subscription_id, amount, currency, payment_method, payment_date)
         VALUES ('${userActive}', '${subEndingNewYear}', 0, 'INR', 'UPI', DATE '2026-11-13');`
      )
    ).toMatch(/payment_records_amount_chk/);
    expect(
      expectFailure(
        `INSERT INTO payment_records (user_id, subscription_id, amount, currency, payment_method, payment_date)
         VALUES ('${userActive}', '${subEndingNewYear}', 499, 'INR', '   ', DATE '2026-11-13');`
      )
    ).toMatch(/payment_records_method_not_blank/);
    expect(
      expectFailure(
        `INSERT INTO payment_records (user_id, subscription_id, amount, currency, payment_method, payment_date)
         VALUES ('${userActive}', '${subEndingNewYear}', 499, 'inr', 'UPI', DATE '2026-11-13');`
      )
    ).toMatch(/payment_records_currency_chk/);

    run(
      `INSERT INTO payment_records (user_id, subscription_id, amount, currency, payment_method, payment_date)
       VALUES ('${userActive}', '${subEndingNewYear}', 499.00, 'INR', 'UPI', DATE '2026-11-13');`
    );
    expect(
      run(
        `SELECT COUNT(*) FROM payment_records
          WHERE user_id = '${userActive}' AND subscription_id = '${subEndingNewYear}';`
      )
    ).toBe('1');
  });

  test('a payment cannot reference another customer subscription', () => {
    const failure = expectFailure(
      `INSERT INTO payment_records (user_id, subscription_id, amount, currency, payment_method, payment_date)
       VALUES ('${userActive}', '${subOther}', 499.00, 'INR', 'UPI', DATE '2026-11-13');`
    );
    expect(failure).toMatch(/payment_records_subscription_owner_fk|foreign key/i);
  });

  test('plans and subscriptions with history cannot be deleted', () => {
    expect(
      expectFailure(`DELETE FROM subscription_plans WHERE plan_id = '${planMonthly}';`)
    ).toMatch(/violates foreign key constraint|referenced/i);
    expect(
      expectFailure(
        `DELETE FROM customer_subscriptions WHERE subscription_id = '${subEndingNewYear}';`
      )
    ).toMatch(/violates foreign key constraint|referenced/i);
  });

  test('a customer with payment records cannot be deleted while audit history remains', () => {
    const failure = expectFailure(`DELETE FROM app_users WHERE user_id = '${userActive}';`);
    expect(failure).toMatch(/violates foreign key constraint|referenced/i);

    run(`DELETE FROM payment_records WHERE user_id = '${userActive}';`);
    run(`DELETE FROM app_users WHERE user_id = '${userActive}';`);
    expect(
      run(`SELECT COUNT(*) FROM customer_subscriptions WHERE user_id = '${userActive}';`)
    ).toBe('0');
  });

  test('the composite payment owner key and plan RESTRICT foreign key exist', () => {
    const definitions = run(
      `SELECT t.relname || '|' || c.conname || '|' || pg_get_constraintdef(c.oid)
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND c.contype IN ('f', 'u')
          AND t.relname IN ('customer_subscriptions', 'payment_records');`
    ).split(/\r?\n/);

    expect(
      definitions.some((line) =>
        /customer_subscriptions\|.*UNIQUE \(subscription_id, user_id\)/.test(line)
      )
    ).toBe(true);
    expect(
      definitions.some((line) =>
        /payment_records\|payment_records_subscription_owner_fk\|FOREIGN KEY \(subscription_id, user_id\) REFERENCES customer_subscriptions\(subscription_id, user_id\) ON DELETE RESTRICT/.test(
          line
        )
      )
    ).toBe(true);
    expect(
      definitions.some(
        (line) =>
          /customer_subscriptions\|.*FOREIGN KEY \(plan_id\) REFERENCES subscription_plans\(plan_id\) ON DELETE RESTRICT/.test(
            line
          )
      )
    ).toBe(true);
  });
});
