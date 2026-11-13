/**
 * Phase 1.5 schema contract (static).
 *
 * These assertions run offline and guard the properties that make the migration
 * safe to review: it is additive only, the system credential table can never
 * become a per-customer table, and the targeted runner refuses unsafe targets.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS contract module shared with db scripts
const { EXPECTED_SCHEMA } = require(join(__dirname, '..', '..', 'db', 'expected-schema'));

const ROOT = join(__dirname, '..', '..');
const MIGRATION_NAME = '2026-11-12-add-phase1-5-broker-market-data.sql';
const migrationSource = readFileSync(join(ROOT, 'db', 'migrations', MIGRATION_NAME), 'utf8');
// Comments mention the statements the migration avoids; only SQL code matters.
const migration = migrationSource.replace(/--.*$/gm, '');
const runner = readFileSync(join(ROOT, 'db', 'migrate-phase1-5.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('Phase 1.5 migration', () => {
  test('creates the three Phase 1.5 tables additively', () => {
    for (const table of [
      'market_data_connections',
      'market_data_oauth_states',
      'global_ingestion_locks',
    ]) {
      expect(migration).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`)
      );
    }
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  test('system connections have no owner column and are restricted to SYSTEM', () => {
    const connections = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS market_data_connections'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS market_data_connections')
    );
    expect(connections).not.toMatch(/\buser_id\b/);
    expect(connections).not.toMatch(/\bowner_user_id\b/);
    expect(connections).toContain("CHECK (designation = 'SYSTEM')");
    expect(connections).toContain('UNIQUE (designation, provider)');
    expect(connections).toContain("CHECK (provider IN ('KITE', 'UPSTOX'))");
    expect(connections).toContain(
      "CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR'))"
    );
    expect(connections).toContain('encrypted_access_token');
    expect(connections).toContain('encrypted_refresh_token');
    expect(connections).toContain('last_successful_use_at');
  });

  test('OAuth state stores only a hash and enforces single-row validity', () => {
    expect(migration).toContain('state_hash   TEXT        PRIMARY KEY');
    expect(migration).toContain('CHECK (char_length(state_hash) = 64)');
    expect(migration).toContain('consumed_at');
    expect(migration).toContain('CHECK (expires_at > created_at)');
  });

  test('the ingestion lease is keyed by name and validates its lease window', () => {
    expect(migration).toContain('lock_name         TEXT        PRIMARY KEY');
    expect(migration).toContain('lease_owner');
    expect(migration).toContain('released_at');
    expect(migration).toContain('CHECK (lease_expires_at > acquired_at)');
  });

  test('expected-schema declares the new tables for verification', () => {
    for (const table of [
      'market_data_connections',
      'market_data_oauth_states',
      'global_ingestion_locks',
    ]) {
      expect(EXPECTED_SCHEMA[table]).toBeDefined();
    }
    expect(EXPECTED_SCHEMA.market_data_connections).not.toContain('user_id');
  });
});

describe('Phase 1.5 targeted migration runner', () => {
  test('reads a dedicated URL and requires explicit approval and host pinning', () => {
    expect(runner).toContain('PHASE15_DATABASE_URL');
    expect(runner).not.toMatch(/process\.env\.DATABASE_URL/);
    expect(runner).toContain('ALLOW_PHASE15_MIGRATION');
    expect(runner).toContain('EXPECTED_PHASE15_HOST');
    expect(runner).toContain('FORBIDDEN_DATABASE_HOST');
    expect(runner).toContain("process.env.NODE_ENV === 'production'");
    expect(runner).toContain('target.pooled');
  });

  test('executes only CREATE statements from the single migration file', () => {
    expect(runner).toContain("MIGRATION_FILE = '2026-11-12-add-phase1-5-broker-market-data.sql'");
    expect(runner).toContain("/^CREATE\\b/i");
  });

  test('is exposed as a dedicated npm script', () => {
    expect(packageJson.scripts['db:phase1-5:migrate']).toBe('node db/migrate-phase1-5.js');
  });
});
