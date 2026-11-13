/**
 * Regression tests for the staging harness safety invariants. These never
 * connect to a database: a fake SQL client records statements only.
 */

import {
  SYNTHETIC_EMAIL_PREFIX,
  SYNTHETIC_INSTRUMENT_BASE,
  StagingRun,
  assertSyntheticInstrumentIds,
  assertSyntheticOwners,
  type Sql,
} from "./harness";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RecordedQuery {
  text: string;
  params: unknown[];
}

class FakeSql {
  readonly queries: RecordedQuery[] = [];

  async query(text: string, params: unknown[] = []): Promise<unknown[]> {
    this.queries.push({ text, params });
    return [];
  }
}

function makeRun(runId: string): { run: StagingRun; sql: FakeSql } {
  const sql = new FakeSql();
  return { run: new StagingRun(sql as unknown as Sql, runId), sql };
}

describe("synthetic identifiers", () => {
  it("uses UUID app-user owners, reserved instrument ids and ZZTEST symbols", () => {
    const { run } = makeRun("11111111-2222-3333-4444-555555555555");

    expect(UUID_PATTERN.test(run.ownerA)).toBe(true);
    expect(UUID_PATTERN.test(run.ownerB)).toBe(true);
    expect(run.ownerA).not.toBe(run.ownerB);

    expect(run.kiteUserIdA.startsWith(SYNTHETIC_EMAIL_PREFIX)).toBe(true);
    expect(run.kiteUserIdB.startsWith(SYNTHETIC_EMAIL_PREFIX)).toBe(true);

    for (const id of Object.values(run.instrumentIds)) {
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(SYNTHETIC_INSTRUMENT_BASE);
    }

    for (const symbol of Object.values(run.symbols)) {
      expect(symbol.startsWith("ZZTEST")).toBe(true);
    }
  });

  it("gives independent runs disjoint owners and instruments", () => {
    const first = makeRun("aaaaaaaa-0000-0000-0000-000000000001").run;
    const second = makeRun("bbbbbbbb-0000-0000-0000-000000000002").run;

    expect(first.ownerA).not.toBe(second.ownerA);
    expect(first.ownerB).not.toBe(second.ownerB);

    const firstIds = new Set(Object.values(first.instrumentIds));
    for (const id of Object.values(second.instrumentIds)) {
      expect(firstIds.has(id)).toBe(false);
    }
  });

  it("rejects cleanup identifiers outside the reserved space", () => {
    expect(() => assertSyntheticOwners(["real-kite-user-42"])).toThrow(
      /synthetic run UUID/
    );
    expect(() => assertSyntheticOwners(["zztest-"])).toThrow();

    expect(() =>
      assertSyntheticInstrumentIds([SYNTHETIC_INSTRUMENT_BASE - 1])
    ).toThrow(/reserved range/);
    expect(() =>
      assertSyntheticInstrumentIds([Number.NaN])
    ).toThrow(/reserved range/);
  });
});

describe("fixture classification", () => {
  it("seeds active NSE instruments for success paths and separate rejection fixtures", async () => {
    const { run, sql } = makeRun("cccccccc-0000-0000-0000-000000000003");
    await run.seedBase();

    const inserts = sql.queries.filter((query) =>
      query.text.includes("INSERT INTO instruments")
    );
    expect(inserts).toHaveLength(8);

    const byId = new Map(inserts.map((query) => [query.params[0], query.params]));

    // Success-path fixtures: active NSE.
    for (const key of ["active", "active2", "outside", "noHistory", "stale", "noZones"] as const) {
      const row = byId.get(run.instrumentIds[key]);
      expect(row?.[2]).toBe("NSE");
      expect(row?.[4]).toBe(true);
    }

    // Rejection fixtures are distinct rows with distinct reasons.
    const inactive = byId.get(run.instrumentIds.inactive);
    expect(inactive?.[2]).toBe("NSE");
    expect(inactive?.[4]).toBe(false);

    const nonNse = byId.get(run.instrumentIds.nonNse);
    expect(nonNse?.[2]).toBe("BSE");
    expect(nonNse?.[4]).toBe(true);
  });
});

describe("cleanup scope", () => {
  it("deletes only parameterized, run-scoped rows and never truncates", async () => {
    const { run, sql } = makeRun("dddddddd-0000-0000-0000-000000000004");
    await run.cleanup();

    expect(sql.queries.length).toBeGreaterThan(0);

    for (const query of sql.queries) {
      expect(query.text).not.toMatch(/\bTRUNCATE\b/i);
      expect(query.text).not.toMatch(/\bDROP\b/i);

      if (/\bDELETE\b/i.test(query.text)) {
        expect(query.text).toMatch(/\bWHERE\b/i);
        expect(query.params.length).toBeGreaterThan(0);
      }
    }

    const ownerDeletes = sql.queries.filter((query) =>
      /owner_user_id = ANY\(\$1::uuid\[\]\)/.test(query.text)
    );
    expect(ownerDeletes.length).toBeGreaterThanOrEqual(3);
    for (const query of ownerDeletes) {
      expect(query.params[0]).toEqual([
        run.ownerA as string,
        run.ownerB as string,
      ]);
    }

    const appUserDelete = sql.queries.find((query) =>
      /DELETE FROM app_users/.test(query.text)
    );
    expect(appUserDelete?.text).toMatch(/lower\(email\) LIKE \$2/);
    expect(appUserDelete?.params[0]).toEqual([
      run.ownerA as string,
      run.ownerB as string,
    ]);
    expect(appUserDelete?.params[1]).toContain(run.runId);

    const sessionDelete = sql.queries.find((query) =>
      /DELETE FROM kite_sessions/.test(query.text)
    );
    expect(sessionDelete?.params[0]).toEqual([
      run.kiteUserIdA,
      run.kiteUserIdB,
    ]);
  });

  it("is safe to call more than once", async () => {
    const { run } = makeRun("eeeeeeee-0000-0000-0000-000000000005");
    await expect(run.cleanup()).resolves.toBeUndefined();
    await expect(run.cleanup()).resolves.toBeUndefined();
  });
});
