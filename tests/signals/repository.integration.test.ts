/**
 * Signals repository SQL against a DISPOSABLE PostgreSQL database.
 *
 * This suite executes the real `lib/signals/repository.ts` statements — it does
 * not re-implement them. The Neon HTTP client is replaced by a test adapter
 * that serialises the tagged-template values to SQL literals and runs the
 * resulting text through the local `psql` binary. Production database behaviour
 * (including the exact SQL text) is untouched.
 *
 * Safety:
 *   * Runs only when SIGNALS_REPOSITORY_TEST_DATABASE_URL is set.
 *   * The URL must be loopback, on a non-default port, and its database name
 *     must start with `demandscan_signals_repo_`.
 *   * The public schema must be empty before anything is applied.
 *   * It never reads DATABASE_URL, SIGNALS_DATABASE_URL or any Vercel env.
 *
 * Boot a throwaway cluster, create a matching database, run this file with the
 * env var, then stop the cluster and delete its directory.
 */

import { execFileSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import { readdirSync } from "fs";
import { join } from "path";
import type { AppUser } from "@/lib/auth/types";
import { signalRequestFingerprint } from "@/lib/signals/fingerprint";
import {
  countCustomerUnread,
  findCustomerSignal,
  findSignalDetail,
  listCustomerInbox,
  listEligibleRecipients,
  listSignalHistory,
  publishSignal as insertPublication,
  retryFailedRecipients as retryInRepository,
  setCustomerReadState,
} from "@/lib/signals/repository";
import {
  claimDueRecipients,
  countPendingRecipients,
  markRecipientFailed,
  markRecipientSent,
  markRecipientSkipped,
  releaseClaimedRecipients,
} from "@/lib/signals/delivery-repository";
import { dispatchDueSignals } from "@/lib/signals/dispatcher";
import { dispatchPublishedSignal } from "@/lib/signals/immediate-dispatch";
import type {
  SignalsEmailConfig,
  SignalsEmailConfigResult,
} from "@/lib/signals/email-config";
import type { SignalsEmailTransport } from "@/lib/signals/email-transport";
import { retryDelaySeconds } from "@/lib/signals/dispatch-policy";
import {
  publishSignal as publishThroughService,
  retryFailedRecipients as retryThroughService,
  signalDetail,
} from "@/lib/signals/service";

jest.mock("@/lib/db", () => ({
  getDb: () => (globalThis as { __signalsRepoTestSql?: unknown }).__signalsRepoTestSql,
}));

const TEST_URL =
  process.env.SIGNALS_REPOSITORY_TEST_DATABASE_URL?.trim() || "";
const PSQL = process.env.SIGNALS_PSQL_BIN?.trim() || "psql";

const DB_DIR = join(__dirname, "..", "..", "db");
const MIGRATIONS_DIR = join(DB_DIR, "migrations");

const BASE_CHAIN = [
  "2024-10-18-add-aggregation-schema.sql",
  "2024-10-18-add-scanner-schema.sql",
  "2024-10-18-v1-intraday-scoring-history.sql",
  "2026-10-20-add-scan-batch-checkpoints.sql",
  "2026-11-12-add-internal-identity-foundation.sql",
  "2026-11-12-add-phase1-5-broker-market-data.sql",
  "2026-11-12-add-phase2-firebase-auth.sql",
  "2026-11-06-add-live-trade.sql",
  "2026-11-09-live-trade-allow-repeat-instruments.sql",
  "2026-11-13-live-trade-internal-ownership.sql",
  "2026-11-13-phase4-subscriptions.sql",
  "2026-11-14-add-signals.sql",
  "2026-11-15-add-signals-idempotency-fingerprint.sql",
];

jest.setTimeout(180_000);

// ─── Disposable-target guard ─────────────────────────────────────────────────

function assertDisposable(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Test URL must use the postgres protocol.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Test URL must point at loopback.");
  }
  if (!url.port || url.port === "5432") {
    throw new Error("Test URL must use the dedicated cluster port, not 5432.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database.startsWith("demandscan_signals_repo_")) {
    throw new Error(
      "Test database name must start with demandscan_signals_repo_."
    );
  }
}

if (TEST_URL) assertDisposable(TEST_URL);

// ─── psql transport ──────────────────────────────────────────────────────────

type Cell = string | null;
type Row = Record<string, Cell>;

/**
 * Minimal RFC 4180 parser for psql --csv. Unquoted empty fields are NULL;
 * quoted empty fields are the empty string.
 */
function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;

  const pushField = () => {
    row.push(wasQuoted ? field : field === "" ? null : field);
    field = "";
    wasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\r" && text[i + 1] === "\n") {
      pushRow();
      i += 1;
    } else if (char === "\n" || char === "\r") {
      pushRow();
    } else {
      field += char;
    }
  }

  if (field !== "" || wasQuoted || row.length > 0) pushRow();
  return rows;
}

function toRows(text: string): Row[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => String(cell ?? ""));
  return rows.slice(1).map((cells) => {
    const row: Row = {};
    header.forEach((name, index) => {
      row[name] = cells[index] ?? null;
    });
    return row;
  });
}

function psql(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PSQL,
      [TEST_URL, "-X", "-q", "--csv", "-v", "ON_ERROR_STOP=1", "-f", "-"],
      {
        env: { ...process.env, PGTZ: "UTC" },
        windowsHide: true,
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      // Windows psql translates stored "\n" to "\r\n" on stdout. That is a
      // transport artifact, not the stored value, so undo it before parsing.
      if (code === 0) resolve(stdout.replace(/\r\n/g, "\n"));
      else reject(new Error(stderr.trim() || `psql exited with code ${code}`));
    });
    child.stdin.end(text, "utf8");
  });
}

async function dbQuery(text: string): Promise<Row[]> {
  return toRows(await psql(text));
}

async function scalar(text: string): Promise<Cell> {
  const rows = await dbQuery(text);
  return rows.length === 0 ? null : Object.values(rows[0])[0] ?? null;
}

async function count(text: string): Promise<number> {
  return Number((await scalar(text)) ?? 0);
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" || typeof value === "bigint") {
    if (!Number.isFinite(Number(value))) {
      throw new Error("Non-finite number cannot be sent to PostgreSQL.");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "ARRAY[]::uuid[]";
    return `ARRAY[${value.map((item) => sqlLiteral(item)).join(", ")}]`;
  }
  if (typeof value === "string") {
    if (value.includes("\u0000")) {
      throw new Error("NUL byte cannot be sent to PostgreSQL.");
    }
    return `'${value.replace(/'/g, "''")}'`;
  }
  throw new Error(`Unsupported SQL parameter type: ${typeof value}`);
}

/**
 * The repository calls `getDb()` as a tagged template. This adapter rebuilds
 * the statement with safely quoted literals, which psql can execute directly.
 */
function psqlTag(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<Row[]> {
  const text = strings.reduce(
    (acc, part, index) =>
      acc + part + (index < values.length ? sqlLiteral(values[index]) : ""),
    ""
  );
  return dbQuery(text);
}

function psqlFile(path: string): void {
  execFileSync(
    PSQL,
    [TEST_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path],
    { encoding: "utf8", windowsHide: true }
  );
}

const describeDb = TEST_URL ? describe : describe.skip;

async function expectSignalsError(
  promise: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, code });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describeDb("Signals repository SQL (disposable PostgreSQL)", () => {
  const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
  const emailPrefix = `sigrepo-${RUN}`;

  let actor: AppUser;
  let recipients: string[] = [];
  let suspendedCustomer = "";
  let adminCustomer = "";

  function key(label: string): string {
    return `${emailPrefix}-${label}`;
  }

  async function publish(
    body: Record<string, unknown>
  ): Promise<Awaited<ReturnType<typeof publishThroughService>>> {
    return publishThroughService(actor, body);
  }

  async function insertUser(
    label: string,
    role: "SUPER_ADMIN" | "ADMIN" | "CUSTOMER",
    status: "ACTIVE" | "SUSPENDED" | "DISABLED"
  ): Promise<string> {
    const rows = await dbQuery(
      `INSERT INTO app_users (email, display_name, role, status)
       VALUES ('${emailPrefix}-${label}@example.com', '${label}', '${role}', '${status}')
       RETURNING user_id;`
    );
    return String(rows[0].user_id);
  }

  async function recipientsOf(signalId: string): Promise<Row[]> {
    return dbQuery(
      `SELECT r.user_id, r.email_address, r.email_status, r.email_attempts,
              r.email_error, r.email_lease_owner,
              (r.email_next_attempt_at IS NOT NULL) AS has_next_attempt,
              (r.email_sent_at IS NOT NULL) AS has_sent_at,
              (r.read_at IS NOT NULL) AS is_read
         FROM signal_recipients r
        WHERE r.signal_id = '${signalId}'
        ORDER BY r.user_id;`
    );
  }

  beforeAll(async () => {
    assertDisposable(TEST_URL);

    const tables = Number(
      (await scalar(
        `SELECT count(*)::int
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`
      )) ?? 0
    );
    expect(tables).toBe(0);

    const url = new URL(TEST_URL);
    console.log(
      `Repository verification target: host=${url.hostname} ` +
        `port=${url.port} database=${url.pathname.slice(1)} ` +
        "(credentials omitted)"
    );

    psqlFile(join(DB_DIR, "schema.sql"));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(files).toEqual([...BASE_CHAIN].sort());
    for (const file of BASE_CHAIN) psqlFile(join(MIGRATIONS_DIR, file));

    const actorId = await insertUser("root", "SUPER_ADMIN", "ACTIVE");
    actor = {
      userId: actorId,
      email: `${emailPrefix}-root@example.com`,
      displayName: "root",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    };

    recipients = [];
    for (let index = 1; index <= 5; index += 1) {
      recipients.push(await insertUser(`recipient-${index}`, "CUSTOMER", "ACTIVE"));
    }
    suspendedCustomer = await insertUser("suspended", "CUSTOMER", "SUSPENDED");
    adminCustomer = await insertUser("staff", "ADMIN", "ACTIVE");

    (globalThis as { __signalsRepoTestSql?: unknown }).__signalsRepoTestSql =
      psqlTag;
  });

  beforeEach(async () => {
    await dbQuery("DELETE FROM signals;");
    await dbQuery("DELETE FROM admin_audit_log;");
    await dbQuery(
      `DELETE FROM app_users WHERE email LIKE '${emailPrefix}-temp-%';`
    );
    await dbQuery(
      `UPDATE app_users SET status = 'ACTIVE'
        WHERE user_id IN (${recipients.map((id) => `'${id}'`).join(", ")});`
    );
    await dbQuery(
      `UPDATE app_users SET status = 'SUSPENDED'
        WHERE user_id = '${suspendedCustomer}';`
    );
  });

  afterAll(async () => {
    if (!TEST_URL) return;
    await dbQuery("DELETE FROM signals;");
    await dbQuery("DELETE FROM admin_audit_log;");
    await dbQuery(`DELETE FROM app_users WHERE email LIKE '${emailPrefix}-%';`);
  });

  // 1 ─ Eligible discovery

  it("discovers only ACTIVE CUSTOMER recipients with the search applied", async () => {
    const page = await listEligibleRecipients("", 50);
    const ids = page.recipients.map((recipient) => recipient.userId);
    expect(ids.sort()).toEqual([...recipients].sort());
    expect(ids).not.toContain(suspendedCustomer);
    expect(ids).not.toContain(adminCustomer);
    expect(ids).not.toContain(actor.userId);
    expect(page.hasMore).toBe(false);

    const filtered = await listEligibleRecipients("recipient-2", 50);
    expect(filtered.recipients.map((recipient) => recipient.userId)).toEqual([
      recipients[1],
    ]);

    const firstPage = await listEligibleRecipients("", 2);
    expect(firstPage.recipients).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
  });

  // 2, 7 ─ Explicit publication, snapshot and audit in one unit

  it("publishes to explicit recipients with a snapshot and audit event", async () => {
    const message = "Explicit\nsignal 🔥";
    const audience = {
      mode: "SELECTED" as const,
      userIds: [recipients[0], recipients[1]],
    };

    const publication = await publish({
      message,
      audience,
      idempotencyKey: key("explicit"),
    });

    expect(publication.reused).toBe(false);
    expect(publication.recipientCount).toBe(2);

    const signal = await dbQuery(
      `SELECT message, idempotency_key, idempotency_fingerprint,
              (SELECT count(*)::int FROM signal_recipients
                WHERE signal_id = s.signal_id) AS recipient_count
         FROM signals s WHERE signal_id = '${publication.signalId}';`
    );
    expect(signal[0].message).toBe(message);
    expect(signal[0].idempotency_key).toBe(key("explicit"));
    expect(signal[0].idempotency_fingerprint).toBe(
      signalRequestFingerprint(message, audience)
    );
    expect(Number(signal[0].recipient_count)).toBe(2);

    const stored = await recipientsOf(publication.signalId);
    expect(stored.map((row) => row.user_id).sort()).toEqual(
      [recipients[0], recipients[1]].sort()
    );
    for (const row of stored) {
      expect(row.email_status).toBe("PENDING");
      expect(Number(row.email_attempts)).toBe(0);
      expect(row.has_next_attempt).toBe("t");
      expect(row.is_read).toBe("f");
    }

    // The email snapshot survives a later account change.
    await dbQuery(
      `UPDATE app_users SET email = 'changed-${RUN}@example.com'
        WHERE user_id = '${recipients[0]}';`
    );
    const snapshot = await scalar(
      `SELECT email_address FROM signal_recipients
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[0]}';`
    );
    expect(snapshot).toBe(`${emailPrefix}-recipient-1@example.com`);
    await dbQuery(
      `UPDATE app_users SET email = '${emailPrefix}-recipient-1@example.com'
        WHERE user_id = '${recipients[0]}';`
    );

    const audit = await dbQuery(
      `SELECT action, target_entity_type, target_entity_id,
              metadata->>'audienceMode' AS audience_mode,
              (metadata->>'requestedCount')::int AS requested_count,
              (metadata->>'recipientCount')::int AS recipient_count
         FROM admin_audit_log
        WHERE target_entity_id = '${publication.signalId}';`
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("SIGNAL_PUBLISHED");
    expect(audit[0].target_entity_type).toBe("signal");
    expect(audit[0].audience_mode).toBe("SELECTED");
    expect(Number(audit[0].requested_count)).toBe(2);
    expect(Number(audit[0].recipient_count)).toBe(2);
  });

  // 3 ─ ALL_ELIGIBLE publication

  it("resolves an all-eligible audience inside the statement", async () => {
    const publication = await publish({
      message: "Everyone",
      audience: { mode: "ALL_ELIGIBLE" },
    });

    expect(publication.recipientCount).toBe(recipients.length);
    const stored = await recipientsOf(publication.signalId);
    expect(stored.map((row) => row.user_id).sort()).toEqual(
      [...recipients].sort()
    );
    expect(
      await scalar(
        `SELECT idempotency_fingerprint IS NULL FROM signals
          WHERE signal_id = '${publication.signalId}';`
      )
    ).toBe("t");

    expect(
      await scalar(
        `SELECT metadata->>'audienceMode' FROM admin_audit_log
          WHERE target_entity_id = '${publication.signalId}';`
      )
    ).toBe("ALL_ELIGIBLE");
  });

  // 4 ─ Ineligible explicit recipient rejects the whole request

  it("writes nothing when one explicit recipient is not an active CUSTOMER", async () => {
    await expectSignalsError(
      publish({
        message: "Mixed audience",
        audience: {
          mode: "SELECTED",
          userIds: [recipients[0], suspendedCustomer],
        },
        idempotencyKey: key("ineligible"),
      }),
      409,
      "RECIPIENT_NOT_ELIGIBLE"
    );

    expect(
      await count(`SELECT count(*)::int FROM signals
                    WHERE idempotency_key = '${key("ineligible")}';`)
    ).toBe(0);
    expect(
      await count("SELECT count(*)::int FROM signal_recipients;")
    ).toBe(0);
    expect(
      await count("SELECT count(*)::int FROM admin_audit_log;")
    ).toBe(0);
  });

  // 5 ─ No eligible recipients

  it("writes nothing when no customer is eligible", async () => {
    await dbQuery(
      `UPDATE app_users SET status = 'SUSPENDED'
        WHERE user_id IN (${recipients.map((id) => `'${id}'`).join(", ")});`
    );
    try {
      await expectSignalsError(
        publish({ message: "Nobody", audience: { mode: "ALL_ELIGIBLE" } }),
        409,
        "NO_ELIGIBLE_RECIPIENTS"
      );
      expect(await count("SELECT count(*)::int FROM signals;")).toBe(0);
      expect(
        await count("SELECT count(*)::int FROM admin_audit_log;")
      ).toBe(0);
    } finally {
      await dbQuery(
        `UPDATE app_users SET status = 'ACTIVE'
          WHERE user_id IN (${recipients.map((id) => `'${id}'`).join(", ")});`
      );
    }
  });

  // 6 ─ Recipient limit

  it("refuses an audience above 1,000 without writing", async () => {
    await dbQuery(
      `INSERT INTO app_users (email, display_name, role, status)
       SELECT '${emailPrefix}-temp-' || g || '@example.com',
              'temp ' || g, 'CUSTOMER', 'ACTIVE'
         FROM generate_series(1, 1001) AS g;`
    );
    try {
      expect(
        await count(
          `SELECT count(*)::int FROM app_users
            WHERE role = 'CUSTOMER' AND status = 'ACTIVE';`
        )
      ).toBeGreaterThan(1000);

      await expectSignalsError(
        publish({
          message: "Too many",
          audience: { mode: "ALL_ELIGIBLE" },
          idempotencyKey: key("too-many"),
        }),
        409,
        "TOO_MANY_RECIPIENTS"
      );
      expect(
        await count(
          `SELECT count(*)::int FROM signals
            WHERE idempotency_key = '${key("too-many")}';`
        )
      ).toBe(0);
      expect(
        await count("SELECT count(*)::int FROM signal_recipients;")
      ).toBe(0);
    } finally {
      await dbQuery(
        `DELETE FROM app_users WHERE email LIKE '${emailPrefix}-temp-%';`
      );
    }
  });

  // 8 ─ Atomic rollback on a database constraint failure

  it("rolls back signal, recipients and audit when the insert fails", async () => {
    const signalId = randomUUID();
    const idempotencyKey = key("rollback");
    await expect(
      insertPublication({
        signalId,
        actorUserId: actor.userId,
        message: "a".repeat(10_001),
        audience: {
          mode: "SELECTED",
          userIds: [recipients[0], recipients[1]],
        },
        idempotencyKey,
        idempotencyFingerprint: signalRequestFingerprint(
          "a".repeat(10_001),
          { mode: "SELECTED", userIds: [recipients[0], recipients[1]] }
        ),
      })
    ).rejects.toThrow(/signals_message_len|check constraint|value too long/i);

    expect(
      await count(
        `SELECT count(*)::int FROM signals
          WHERE idempotency_key = '${idempotencyKey}';`
      )
    ).toBe(0);
    expect(
      await count("SELECT count(*)::int FROM signal_recipients;")
    ).toBe(0);
    expect(
      await count("SELECT count(*)::int FROM admin_audit_log;")
    ).toBe(0);
  });

  // 9 ─ Idempotent replay and fingerprint mismatches

  it("replays the same logical request exactly once", async () => {
    const message = "Replay me";
    const audience = {
      mode: "SELECTED" as const,
      userIds: [recipients[0], recipients[1]],
    };

    const first = await publish({
      message,
      audience,
      idempotencyKey: key("replay"),
    });
    const second = await publish({
      message,
      audience: { mode: "SELECTED", userIds: [recipients[1], recipients[0]] },
      idempotencyKey: key("replay"),
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.signalId).toBe(first.signalId);

    expect(await count("SELECT count(*)::int FROM signals;")).toBe(1);
    expect(
      await count("SELECT count(*)::int FROM signal_recipients;")
    ).toBe(2);
    expect(
      await count(
        `SELECT count(*)::int FROM admin_audit_log
          WHERE action = 'SIGNAL_PUBLISHED';`
      )
    ).toBe(1);
  });

  it("rejects key reuse with a different message, recipients or mode", async () => {
    const baseMessage = "Original";
    const baseAudience = {
      mode: "SELECTED" as const,
      userIds: [recipients[0], recipients[1]],
    };
    await publish({
      message: baseMessage,
      audience: baseAudience,
      idempotencyKey: key("mismatch"),
    });

    await expectSignalsError(
      publish({
        message: "Different",
        audience: baseAudience,
        idempotencyKey: key("mismatch"),
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );

    await expectSignalsError(
      publish({
        message: baseMessage,
        audience: { mode: "SELECTED", userIds: [recipients[0]] },
        idempotencyKey: key("mismatch"),
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );

    await expectSignalsError(
      publish({
        message: baseMessage,
        audience: { mode: "ALL_ELIGIBLE" },
        idempotencyKey: key("mismatch"),
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );

    expect(await count("SELECT count(*)::int FROM signals;")).toBe(1);
    expect(
      await count(
        `SELECT count(*)::int FROM signal_recipients
          WHERE signal_id = (SELECT signal_id FROM signals LIMIT 1);`
      )
    ).toBe(2);
  });

  // 10 ─ Concurrent identical publication

  it("creates exactly one publication for concurrent identical requests", async () => {
    const body = {
      message: "Concurrent identical",
      audience: { mode: "SELECTED" as const, userIds: [recipients[0], recipients[1]] },
      idempotencyKey: key("concurrent-same"),
    };

    const results = await Promise.all([
      publish(body),
      publish(body),
    ]);

    expect(results.map((result) => result.reused).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0].signalId).toBe(results[1].signalId);

    expect(await count("SELECT count(*)::int FROM signals;")).toBe(1);
    expect(
      await count("SELECT count(*)::int FROM signal_recipients;")
    ).toBe(2);
    expect(
      await count(
        `SELECT count(*)::int FROM admin_audit_log
          WHERE action = 'SIGNAL_PUBLISHED';`
      )
    ).toBe(1);
  });

  // 11 ─ Concurrent conflicting reuse

  it("lets one concurrent winner commit and rejects the conflicting reuse", async () => {
    const idempotencyKey = key("concurrent-different");
    const audience = {
      mode: "SELECTED" as const,
      userIds: [recipients[0], recipients[1]],
    };

    const settled = await Promise.allSettled([
      publish({ message: "First message", audience, idempotencyKey }),
      publish({ message: "Second message", audience, idempotencyKey }),
    ]);

    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof publish>>> =>
        result.status === "fulfilled"
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected"
    );

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].value.reused).toBe(false);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });

    expect(await count("SELECT count(*)::int FROM signals;")).toBe(1);
    expect(
      await count("SELECT count(*)::int FROM signal_recipients;")
    ).toBe(2);
    expect(
      await count(
        `SELECT count(*)::int FROM admin_audit_log
          WHERE action = 'SIGNAL_PUBLISHED';`
      )
    ).toBe(1);
  });

  // 12 ─ History pagination and summaries

  it("paginates history with delivery and read summaries", async () => {
    const oldest = await publish({
      message: "Oldest",
      audience: { mode: "ALL_ELIGIBLE" },
    });
    const middle = await publish({
      message: "Middle",
      audience: { mode: "ALL_ELIGIBLE" },
    });
    const newest = await publish({
      message: "Newest",
      audience: { mode: "ALL_ELIGIBLE" },
    });

    await dbQuery(
      `UPDATE signals SET published_at = '2026-01-01T00:00:00Z'
        WHERE signal_id = '${oldest.signalId}';`
    );
    await dbQuery(
      `UPDATE signals SET published_at = '2026-01-02T00:00:00Z'
        WHERE signal_id = '${middle.signalId}';`
    );
    await dbQuery(
      `UPDATE signals SET published_at = '2026-01-03T00:00:00Z'
        WHERE signal_id = '${newest.signalId}';`
    );

    await dbQuery(
      `UPDATE signal_recipients SET email_status = 'SENT', email_sent_at = NOW()
        WHERE signal_id = '${newest.signalId}' AND user_id = '${recipients[0]}';`
    );
    await dbQuery(
      `UPDATE signal_recipients SET email_status = 'FAILED', email_error = 'timeout'
        WHERE signal_id = '${newest.signalId}' AND user_id = '${recipients[1]}';`
    );
    await dbQuery(
      `UPDATE signal_recipients SET read_at = NOW()
        WHERE signal_id = '${newest.signalId}' AND user_id = '${recipients[2]}';`
    );

    const firstPage = await listSignalHistory(1, 2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.signals).toHaveLength(2);
    expect(firstPage.signals.map((entry) => entry.signalId)).toEqual([
      newest.signalId,
      middle.signalId,
    ]);

    const newestEntry = firstPage.signals[0];
    expect(newestEntry.delivery).toEqual({
      pending: 3,
      sending: 0,
      sent: 1,
      failed: 1,
      skipped: 0,
    });
    expect(newestEntry.read).toEqual({ read: 1, unread: 4 });
    expect(newestEntry).not.toHaveProperty("recipients");
    expect(JSON.stringify(newestEntry)).not.toContain("@example.com");

    const secondPage = await listSignalHistory(2, 2);
    expect(secondPage.total).toBe(3);
    expect(secondPage.signals.map((entry) => entry.signalId)).toEqual([
      oldest.signalId,
    ]);
  });

  // 13 ─ Detail and recipient statistics

  it("returns signal detail with recipient delivery statistics", async () => {
    const message = "Detail line 1\nDetail line 2 🔥";
    const publication = await publish({
      message,
      audience: {
        mode: "SELECTED",
        userIds: [recipients[0], recipients[1]],
      },
    });

    await dbQuery(
      `UPDATE signal_recipients
          SET email_status = 'SENT', email_sent_at = NOW(),
              email_attempts = 1, read_at = NOW()
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[0]}';`
    );
    await dbQuery(
      `UPDATE signal_recipients
          SET email_status = 'FAILED', email_attempts = 2,
              email_last_attempt_at = NOW(),
              email_error = E'SMTP\\nfailed\\tat host'
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[1]}';`
    );

    const detail = await signalDetail(publication.signalId);
    expect(detail.message).toBe(message);
    expect(detail.recipientCount).toBe(2);
    expect(detail.delivery).toEqual({
      pending: 0,
      sending: 0,
      sent: 1,
      failed: 1,
      skipped: 0,
    });
    expect(detail.read).toEqual({ read: 1, unread: 1 });

    const sent = detail.recipients.find(
      (recipient) => recipient.userId === recipients[0]
    );
    const failed = detail.recipients.find(
      (recipient) => recipient.userId === recipients[1]
    );
    expect(sent).toMatchObject({
      emailStatus: "SENT",
      emailAttempts: 1,
    });
    expect(sent?.emailSentAt).not.toBeNull();
    expect(sent?.readAt).not.toBeNull();
    expect(failed).toMatchObject({
      emailStatus: "FAILED",
      emailAttempts: 2,
      emailError: "SMTP failed at host",
    });

    expect(await findSignalDetail(randomUUID())).toBeNull();
  });

  // 14, 15, 16 ─ Retry eligibility, untouched statuses, audit

  it("retries only FAILED recipients, leaves every other status alone, and audits", async () => {
    const publication = await publish({
      message: "Retry target",
      audience: { mode: "ALL_ELIGIBLE" },
    });

    await dbQuery(
      `UPDATE signal_recipients
          SET email_status = 'FAILED', email_attempts = 2, email_error = 'boom'
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[0]}';`
    );
    await dbQuery(
      `UPDATE signal_recipients
          SET email_status = 'SENT', email_sent_at = NOW()
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[1]}';`
    );
    await dbQuery(
      `UPDATE signal_recipients
          SET email_status = 'SENDING', email_lease_owner = 'worker-1',
              email_lease_expires_at = NOW() + interval '5 minutes'
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[2]}';`
    );
    await dbQuery(
      `UPDATE signal_recipients SET email_status = 'SKIPPED'
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[3]}';`
    );
    // recipients[4] stays PENDING by default.

    const result = await retryInRepository(actor, publication.signalId);
    expect(result).toEqual({ signalFound: true, retriedCount: 1 });

    const byUser = new Map(
      (await recipientsOf(publication.signalId)).map((row) => [row.user_id, row])
    );

    expect(byUser.get(recipients[0])).toMatchObject({
      email_status: "PENDING",
      email_error: null,
      email_lease_owner: null,
      has_next_attempt: "t",
    });
    expect(Number(byUser.get(recipients[0])?.email_attempts)).toBe(2);
    expect(byUser.get(recipients[1])?.email_status).toBe("SENT");
    expect(byUser.get(recipients[1])?.has_sent_at).toBe("t");
    expect(byUser.get(recipients[2])).toMatchObject({
      email_status: "SENDING",
      email_lease_owner: "worker-1",
    });
    expect(byUser.get(recipients[3])?.email_status).toBe("SKIPPED");
    expect(byUser.get(recipients[4])?.email_status).toBe("PENDING");

    const audit = await dbQuery(
      `SELECT action,
              (metadata->>'eligibleFailedCount')::int AS eligible_failed,
              (metadata->>'retriedCount')::int AS retried
         FROM admin_audit_log
        WHERE target_entity_id = '${publication.signalId}'
          AND action = 'SIGNAL_EMAIL_RETRY_REQUESTED';`
    );
    expect(audit).toHaveLength(1);
    expect(Number(audit[0].eligible_failed)).toBe(1);
    expect(Number(audit[0].retried)).toBe(1);

    // The service path maps the same result.
    await expect(
      retryThroughService(actor, publication.signalId)
    ).resolves.toEqual({ signalId: publication.signalId, retriedCount: 0 });

    expect(
      await scalar(
        `SELECT action FROM admin_audit_log
          WHERE target_entity_id = '${publication.signalId}'
            AND action = 'SIGNAL_EMAIL_RETRY_REQUESTED'
          ORDER BY created_at DESC LIMIT 1;`
      )
    ).toBe("SIGNAL_EMAIL_RETRY_REQUESTED");
  });

  it("does not retry a FAILED recipient whose account is no longer active", async () => {
    const publication = await publish({
      message: "Suspended retry",
      audience: {
        mode: "SELECTED",
        userIds: [recipients[0], recipients[1]],
      },
    });

    await dbQuery(
      `UPDATE signal_recipients SET email_status = 'FAILED', email_error = 'boom'
        WHERE signal_id = '${publication.signalId}'
          AND user_id = '${recipients[0]}';`
    );
    await dbQuery(
      `UPDATE app_users SET status = 'SUSPENDED' WHERE user_id = '${recipients[0]}';`
    );
    try {
      expect(
        await retryInRepository(actor, publication.signalId)
      ).toEqual({ signalFound: true, retriedCount: 0 });
      expect(
        await scalar(
          `SELECT email_status FROM signal_recipients
            WHERE signal_id = '${publication.signalId}'
              AND user_id = '${recipients[0]}';`
        )
      ).toBe("FAILED");
    } finally {
      await dbQuery(
        `UPDATE app_users SET status = 'ACTIVE' WHERE user_id = '${recipients[0]}';`
      );
    }
  });

  // ─── Phase S4: customer inbox and read state ──────────────────────────────

  async function publishAt(
    message: string,
    userIds: string[],
    publishedAt: string
  ): Promise<string> {
    const publication = await publish({
      message,
      audience: { mode: "SELECTED", userIds },
    });
    await dbQuery(
      `UPDATE signals SET published_at = '${publishedAt}'
        WHERE signal_id = '${publication.signalId}';`
    );
    return publication.signalId;
  }

  it("lists only the caller's published signals, newest first, with totals", async () => {
    const older = await publishAt("Older signal", [recipients[0], recipients[1]], "2026-11-01T00:00:00Z");
    const newer = await publishAt("  Newer\nsignal 🔥  ", [recipients[0]], "2026-11-03T00:00:00Z");
    const otherCustomer = await publishAt("Only for recipient 2", [recipients[1]], "2026-11-02T00:00:00Z");
    const archived = await publishAt("Archived", [recipients[0]], "2026-11-04T00:00:00Z");
    await dbQuery(
      `UPDATE signals SET status = 'ARCHIVED' WHERE signal_id = '${archived}';`
    );

    // Customers in this fixture have no subscription row; Signals must not care.
    expect(
      Number(
        await scalar(
          `SELECT count(*)::int FROM customer_subscriptions
            WHERE user_id = '${recipients[0]}';`
        )
      )
    ).toBe(0);

    const firstPage = await listCustomerInbox(recipients[0], 1, 1);
    expect(firstPage.signals.map((signal) => signal.signalId)).toEqual([newer]);
    expect(firstPage.signals[0].messagePreview).toBe(" Newer signal 🔥 ");
    expect(firstPage.total).toBe(2);
    expect(firstPage.unreadCount).toBe(2);

    const secondPage = await listCustomerInbox(recipients[0], 2, 1);
    expect(secondPage.signals.map((signal) => signal.signalId)).toEqual([older]);

    const beyond = await listCustomerInbox(recipients[0], 3, 1);
    expect(beyond.signals).toEqual([]);
    expect(beyond.total).toBe(2);
    expect(beyond.unreadCount).toBe(2);

    const otherInbox = await listCustomerInbox(recipients[1], 1, 20);
    expect(otherInbox.signals.map((signal) => signal.signalId).sort()).toEqual(
      [older, otherCustomer].sort()
    );
    expect(otherInbox.signals.map((signal) => signal.signalId)).not.toContain(newer);

    const detail = await findCustomerSignal(recipients[0], newer);
    expect(detail?.message).toBe("  Newer\nsignal 🔥  ");
    expect(detail?.isRead).toBe(false);
    expect(await findCustomerSignal(recipients[0], otherCustomer)).toBeNull();
    expect(await findCustomerSignal(recipients[0], archived)).toBeNull();
  });

  it("toggles read state without touching delivery fields or other customers", async () => {
    const signalId = await publishAt("Read me", [recipients[0]], "2026-11-05T00:00:00Z");

    const before = await recipientsOf(signalId);
    expect(before).toHaveLength(1);
    expect(await countCustomerUnread(recipients[0])).toBe(1);

    const read = await setCustomerReadState(recipients[0], signalId, true);
    expect(read?.isRead).toBe(true);
    expect(read?.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await countCustomerUnread(recipients[0])).toBe(0);

    // Repeating the same request keeps the original timestamp.
    const repeated = await setCustomerReadState(recipients[0], signalId, true);
    expect(repeated?.readAt).toBe(read?.readAt);

    const afterRead = await recipientsOf(signalId);
    expect(afterRead[0].email_status).toBe(before[0].email_status);
    expect(afterRead[0].email_attempts).toBe(before[0].email_attempts);
    expect(afterRead[0].email_error).toBe(before[0].email_error);
    expect(afterRead[0].email_lease_owner).toBe(before[0].email_lease_owner);
    expect(afterRead[0].has_next_attempt).toBe(before[0].has_next_attempt);
    expect(afterRead[0].has_sent_at).toBe(before[0].has_sent_at);

    const unread = await setCustomerReadState(recipients[0], signalId, false);
    expect(unread).toMatchObject({ signalId, readAt: null, isRead: false });
    expect(await countCustomerUnread(recipients[0])).toBe(1);
    await expect(
      setCustomerReadState(recipients[0], signalId, false)
    ).resolves.toMatchObject({ readAt: null, isRead: false });

    // Another customer owns no row for this signal and cannot change it.
    await expect(
      setCustomerReadState(recipients[1], signalId, true)
    ).resolves.toBeNull();
    expect(await findCustomerSignal(recipients[1], signalId)).toBeNull();
    expect(await countCustomerUnread(recipients[1])).toBe(0);

    // Read changes are also refused for archived signals.
    await dbQuery(
      `UPDATE signals SET status = 'ARCHIVED' WHERE signal_id = '${signalId}';`
    );
    await expect(
      setCustomerReadState(recipients[0], signalId, true)
    ).resolves.toBeNull();
    expect(await countCustomerUnread(recipients[0])).toBe(0);
    expect(await findCustomerSignal(recipients[0], signalId)).toBeNull();
  });

  // ─── Email outbox and dispatcher ──────────────────────────────────────────

  describe("email outbox dispatch", () => {
    const EMAIL_CONFIG: SignalsEmailConfig = {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "signals@example.com",
      password: "integration-app-password",
      fromName: "DemandScan Signals",
      fromAddress: "signals@example.com",
      replyTo: null,
      footer: null,
      appUrl: "https://app.example.com",
    };

    function fakeTransport(sent: string[] = []): SignalsEmailTransport {
      return {
        sendMail: async (options) => {
          sent.push(String(options.to));
          return { accepted: [options.to] } as never;
        },
        close: () => {},
      } as SignalsEmailTransport;
    }

    it("claims once, refuses a live lease, and records SENT atomically", async () => {
      const { signalId } = await publish({
        message: "Outbox sent",
        audience: { mode: "SELECTED", userIds: [recipients[0]] },
        idempotencyKey: key("outbox-sent"),
      });

      const first = await claimDueRecipients("owner-a", 5, 90);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        signalId,
        userId: recipients[0],
        emailAddress: `${key("recipient-1")}@example.com`,
        priorAttempts: 0,
        message: "Outbox sent",
      });

      // A live lease cannot be claimed by another dispatcher.
      expect(await claimDueRecipients("owner-b", 5, 90)).toHaveLength(0);

      // A stale owner cannot complete the row.
      expect(await markRecipientSent(first[0].recipientId, "owner-b")).toBe(false);
      expect(await markRecipientSent(first[0].recipientId, "owner-a")).toBe(true);

      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'SENT'
              AND email_attempts = 1
              AND email_sent_at IS NOT NULL
              AND email_lease_owner IS NULL;`
        )
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) FROM signal_email_attempts a
             JOIN signal_recipients r ON r.recipient_id = a.recipient_id
            WHERE r.signal_id = '${signalId}' AND a.outcome = 'SENT';`
        )
      ).toBe(1);
      // SMTP recording never removes the in-app signal.
      expect(
        await count(`SELECT count(*) FROM signals WHERE signal_id = '${signalId}';`)
      ).toBe(1);
    });

    it("reclaims an expired SENDING lease but leaves a future retry alone", async () => {
      const { signalId } = await publish({
        message: "Lease recovery",
        audience: { mode: "SELECTED", userIds: [recipients[0]] },
        idempotencyKey: key("outbox-lease"),
      });

      const first = await claimDueRecipients("owner-a", 5, 90);
      expect(first).toHaveLength(1);

      await dbQuery(
        `UPDATE signal_recipients
            SET email_lease_owner = 'stale-owner',
                email_lease_expires_at = NOW() - INTERVAL '1 minute'
          WHERE signal_id = '${signalId}';`
      );

      const reclaimed = await claimDueRecipients("owner-b", 5, 90);
      expect(reclaimed.map((row) => row.recipientId)).toEqual([
        first[0].recipientId,
      ]);

      await dbQuery(
        `UPDATE signal_recipients
            SET email_status = 'PENDING',
                email_lease_owner = NULL,
                email_lease_expires_at = NULL,
                email_next_attempt_at = NOW() + INTERVAL '1 hour'
          WHERE signal_id = '${signalId}';`
      );

      expect(await claimDueRecipients("owner-c", 5, 90)).toHaveLength(0);
    });

    it("sends to an ACTIVE CUSTOMER and skips suspended or non-customer accounts", async () => {
      const { signalId } = await publish({
        message: "Eligibility check",
        audience: {
          mode: "SELECTED",
          userIds: [recipients[0], recipients[1]],
        },
        idempotencyKey: key("outbox-eligibility"),
      });
      await dbQuery(
        `UPDATE app_users SET status = 'SUSPENDED'
          WHERE user_id = '${recipients[1]}';`
      );

      const staffSignalId = randomUUID();
      await dbQuery(
        `INSERT INTO signals (signal_id, message, created_by)
         VALUES ('${staffSignalId}', 'Staff copy', '${actor.userId}');`
      );
      await dbQuery(
        `INSERT INTO signal_recipients (signal_id, user_id, email_address)
         VALUES ('${staffSignalId}', '${adminCustomer}',
                 '${emailPrefix}-staff-recipient@example.com');`
      );

      const sent: string[] = [];
      const summary = await dispatchDueSignals({
        config: EMAIL_CONFIG,
        transport: fakeTransport(sent),
        owner: "integration-owner",
        batchSize: 10,
      });

      expect(summary).toMatchObject({
        claimed: 3,
        sent: 1,
        skipped: 2,
        failed: 0,
        terminalFailures: 0,
      });
      expect(sent).toEqual([`${key("recipient-1")}@example.com`]);

      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}' AND email_status = 'SENT';`
        )
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}' AND email_status = 'SKIPPED';`
        )
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${staffSignalId}' AND email_status = 'SKIPPED';`
        )
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) FROM signal_email_attempts
            WHERE outcome = 'SKIPPED';`
        )
      ).toBe(2);
      // The in-app signals remain available to the customer inbox.
      expect(
        await count(
          `SELECT count(*) FROM signals
            WHERE signal_id IN ('${signalId}', '${staffSignalId}');`
        )
      ).toBe(2);
    });

    it("backs off, becomes terminal on the fifth failure, and requeues on manual retry", async () => {
      const { signalId } = await publish({
        message: "Retry policy",
        audience: { mode: "SELECTED", userIds: [recipients[0]] },
        idempotencyKey: key("outbox-retry"),
      });

      let owner = "owner-1";
      const [first] = await claimDueRecipients(owner, 5, 90);
      const firstFailure = await markRecipientFailed(
        first.recipientId,
        owner,
        { code: "SMTP_TIMEOUT", message: "The SMTP server did not respond in time." },
        retryDelaySeconds(1)
      );
      expect(firstFailure).toEqual({ applied: true, terminal: false, attempts: 1 });
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'PENDING'
              AND email_next_attempt_at > NOW();`
        )
      ).toBe(1);

      for (let attempt = 2; attempt <= 5; attempt += 1) {
        await dbQuery(
          `UPDATE signal_recipients SET email_next_attempt_at = NOW()
            WHERE signal_id = '${signalId}';`
        );
        owner = `owner-${attempt}`;
        const claims = await claimDueRecipients(owner, 5, 90);
        expect(claims).toHaveLength(1);
        const result = await markRecipientFailed(
          claims[0].recipientId,
          owner,
          { code: "SMTP_TIMEOUT", message: "The SMTP server did not respond in time." },
          retryDelaySeconds(attempt)
        );
        expect(result.attempts).toBe(attempt);
        expect(result.terminal).toBe(attempt === 5);
      }

      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'FAILED' AND email_attempts = 5;`
        )
      ).toBe(1);
      // No automatic claim once terminal.
      expect(await claimDueRecipients("owner-final", 5, 90)).toHaveLength(0);

      const retried = await retryThroughService(actor, signalId);
      expect(retried.retriedCount).toBe(1);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'PENDING' AND email_attempts = 5;`
        )
      ).toBe(1);

      // The manual retry is processable even though the automatic counter is
      // already at the ceiling; another failure is terminal again.
      const [manual] = await claimDueRecipients("owner-manual", 5, 90);
      expect(manual).toMatchObject({ recipientId: first.recipientId, priorAttempts: 5 });
      const finalFailure = await markRecipientFailed(
        manual.recipientId,
        "owner-manual",
        { code: "SMTP_TIMEOUT", message: "The SMTP server did not respond in time." },
        retryDelaySeconds(6)
      );
      expect(finalFailure).toMatchObject({ terminal: true, attempts: 6 });

      expect(
        await count(
          `SELECT count(*) FROM signal_email_attempts a
             JOIN signal_recipients r ON r.recipient_id = a.recipient_id
            WHERE r.signal_id = '${signalId}' AND a.outcome = 'FAILED';`
        )
      ).toBe(6);
      expect(
        await count(`SELECT count(*) FROM signals WHERE signal_id = '${signalId}';`)
      ).toBe(1);
    });
  });

  // ─── Phase S7.1: immediate dispatch production safety ────────────────────

  describe("S7.1 immediate dispatch safety", () => {
    const EMAIL_CONFIG: SignalsEmailConfig = {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "signals@example.com",
      password: "integration-app-password",
      fromName: "DemandScan Signals",
      fromAddress: "signals@example.com",
      replyTo: null,
      footer: null,
      appUrl: "https://app.example.com",
    };

    const configOk = (): SignalsEmailConfigResult => ({
      ok: true,
      config: EMAIL_CONFIG,
    });

    function fakeTransport(sent: string[] = []): SignalsEmailTransport {
      return {
        sendMail: async (options) => {
          sent.push(String(options.to));
          return { accepted: [options.to] } as never;
        },
        close: () => {},
      } as SignalsEmailTransport;
    }

    function attemptsFor(signalId: string): Promise<number> {
      return count(
        `SELECT count(*) FROM signal_email_attempts a
           JOIN signal_recipients r ON r.recipient_id = a.recipient_id
          WHERE r.signal_id = '${signalId}';`
      );
    }

    async function waitUntil(
      check: () => Promise<boolean>,
      label: string
    ): Promise<void> {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out waiting for ${label}`);
    }

    /**
     * Counts row locks held on signal_recipients by OTHER backends. psql runs
     * each repository statement on its own connection, so this only sees the
     * separately spawned holding session.
     */
    function foreignRowLocks(): Promise<number> {
      return count(
        `SELECT count(*)
           FROM pg_locks l
           JOIN pg_class c ON c.oid = l.relation
           JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE c.relname = 'signal_recipients'
            AND l.mode = 'RowShareLock'
            AND l.granted
            AND a.pid <> pg_backend_pid();`
      );
    }

    /** A second connection holding row locks in an open transaction. */
    function holdLocks(recipientIds: readonly string[]): Promise<void> {
      const ids = recipientIds
        .map((id) => `'${id}'::uuid`)
        .join(", ");
      const text =
        "BEGIN;\n" +
        `SELECT recipient_id FROM signal_recipients WHERE recipient_id IN (${ids}) FOR UPDATE;\n` +
        "SELECT pg_sleep(2.5);\n" +
        "COMMIT;";
      return new Promise((resolve, reject) => {
        const child = spawn(
          PSQL,
          [TEST_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", text],
          { env: { ...process.env, PGTZ: "UTC" }, windowsHide: true }
        );
        let stderr = "";
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(stderr.trim() || `psql exited with code ${code}`));
        });
      });
    }

    // 1 ─ Two concurrent dispatchers
    it("cannot claim the same recipient from separate connections", async () => {
      const extra = await insertUser("s71-race-extra", "CUSTOMER", "ACTIVE");
      const audience = { mode: "SELECTED" as const, userIds: [...recipients, extra] };
      const { signalId } = await publish({
        message: "Concurrent claim",
        audience,
        idempotencyKey: key("s71-race"),
      });

      // Three separate psql processes issue the real claim statement at once.
      const batches = await Promise.all([
        claimDueRecipients("race-a", 5, 90),
        claimDueRecipients("race-b", 5, 90),
        claimDueRecipients("race-c", 5, 90),
      ]);

      const claimed = batches.flat();
      expect(claimed).toHaveLength(6);
      expect(new Set(claimed.map((row) => row.recipientId)).size).toBe(6);
      expect(claimed.every((row) => row.signalId === signalId)).toBe(true);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'SENDING'
              AND email_lease_owner IN ('race-a', 'race-b', 'race-c')
              AND email_lease_expires_at IS NOT NULL;`
        )
      ).toBe(6);
    });

    it("skips rows locked by another connection, then claims them after release", async () => {
      const { signalId } = await publish({
        message: "Locked rows",
        audience: { mode: "SELECTED", userIds: [recipients[0]] },
        idempotencyKey: key("s71-locked"),
      });
      const recipientId = String(
        await scalar(
          `SELECT recipient_id FROM signal_recipients
            WHERE signal_id = '${signalId}';`
        )
      );

      const holder = holdLocks([recipientId]);
      await waitUntil(async () => (await foreignRowLocks()) > 0, "holder lock");

      // The real claim statement must not block or steal the locked row.
      expect(await claimDueRecipients("contender", 5, 90)).toHaveLength(0);

      await holder;
      await waitUntil(async () => (await foreignRowLocks()) === 0, "lock release");

      expect(await claimDueRecipients("contender", 5, 90)).toHaveLength(1);
    });

    // 2, 3 ─ Immediate scope and scheduled remainder
    it("scopes immediate dispatch to its signal and leaves overflow for the scheduler", async () => {
      const extraA1 = await insertUser("s71-imm-a1", "CUSTOMER", "ACTIVE");
      const extraA2 = await insertUser("s71-imm-a2", "CUSTOMER", "ACTIVE");
      const extraB1 = await insertUser("s71-imm-b1", "CUSTOMER", "ACTIVE");
      const extraB2 = await insertUser("s71-imm-b2", "CUSTOMER", "ACTIVE");

      const signalA = await publish({
        message: "Immediate scope A",
        audience: {
          mode: "SELECTED",
          userIds: [...recipients, extraA1, extraA2],
        },
        idempotencyKey: key("s71-imm-a"),
      });
      const signalB = await publish({
        message: "Immediate scope B",
        audience: { mode: "SELECTED", userIds: [extraB1, extraB2] },
        idempotencyKey: key("s71-imm-b"),
      });

      const sentA: string[] = [];
      const delivery = await dispatchPublishedSignal(signalA.signalId, {
        resolveConfig: configOk,
        createTransport: () => fakeTransport(sentA),
      });

      // Batch ceiling is 5: the two remaining recipients stay queued.
      expect(delivery).toEqual({
        attempted: 5,
        sent: 5,
        failed: 0,
        skipped: 0,
        pending: 2,
        status: "DISPATCHED",
      });
      const rowsA = await recipientsOf(signalA.signalId);
      expect(sentA).toHaveLength(5);
      expect(sentA.every((email) => rowsA.some((row) => row.email_address === email))).toBe(
        true
      );
      expect(await attemptsFor(signalA.signalId)).toBe(5);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalA.signalId}'
              AND email_status = 'SENT' AND email_attempts = 1;`
        )
      ).toBe(5);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalA.signalId}'
              AND email_status = 'PENDING'
              AND email_attempts = 0
              AND email_lease_owner IS NULL
              AND email_lease_expires_at IS NULL;`
        )
      ).toBe(2);
      expect(await countPendingRecipients(signalA.signalId)).toBe(2);

      // Signal B was never touched by the publish request.
      const rowsB = await recipientsOf(signalB.signalId);
      expect(rowsB).toHaveLength(2);
      for (const row of rowsB) {
        expect(row.email_status).toBe("PENDING");
        expect(Number(row.email_attempts)).toBe(0);
        expect(row.email_lease_owner).toBeNull();
      }
      expect(await attemptsFor(signalB.signalId)).toBe(0);

      // The scheduled dispatcher (global claim) drains A's overflow and B.
      const sentScheduled: string[] = [];
      const summary = await dispatchDueSignals({
        config: EMAIL_CONFIG,
        transport: fakeTransport(sentScheduled),
        owner: "scheduled-s71",
        batchSize: 10,
      });
      expect(summary).toMatchObject({ claimed: 4, sent: 4, failed: 0, skipped: 0 });
      expect(sentScheduled).toHaveLength(4);
      expect(await countPendingRecipients(signalA.signalId)).toBe(0);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id IN ('${signalA.signalId}', '${signalB.signalId}')
              AND email_status = 'SENT' AND email_attempts = 1;`
        )
      ).toBe(9);
    });

    // 4 ─ Release unattempted claims
    it("releases unattempted claims back to PENDING without recording an attempt", async () => {
      const { signalId } = await publish({
        message: "Release claims",
        audience: { mode: "SELECTED", userIds: [recipients[0], recipients[1]] },
        idempotencyKey: key("s71-release"),
      });

      const claims = await claimDueRecipients("release-owner", 5, 90);
      expect(claims).toHaveLength(2);
      const ids = claims.map((row) => row.recipientId);

      // Another owner cannot release a live lease.
      expect(await releaseClaimedRecipients(ids, "wrong-owner")).toBe(0);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'SENDING'
              AND email_lease_owner = 'release-owner';`
        )
      ).toBe(2);

      expect(await releaseClaimedRecipients(ids, "release-owner")).toBe(2);

      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'PENDING'
              AND email_attempts = 0
              AND email_lease_owner IS NULL
              AND email_lease_expires_at IS NULL
              AND email_last_attempt_at IS NULL
              AND email_sent_at IS NULL
              AND email_error IS NULL
              AND email_next_attempt_at <= NOW();`
        )
      ).toBe(2);
      expect(await attemptsFor(signalId)).toBe(0);
      expect(await countPendingRecipients(signalId)).toBe(2);

      // Released rows are immediately claimable again.
      expect(await claimDueRecipients("release-owner-2", 5, 90)).toHaveLength(2);
    });

    // 5 ─ Stale lease owner
    it("refuses every completion from a stale lease owner", async () => {
      const { signalId } = await publish({
        message: "Stale owner",
        audience: { mode: "SELECTED", userIds: [recipients[0], recipients[1]] },
        idempotencyKey: key("s71-stale"),
      });

      const original = await claimDueRecipients("stale-a", 5, 90);
      expect(original).toHaveLength(2);
      await dbQuery(
        `UPDATE signal_recipients
            SET email_lease_expires_at = NOW() - INTERVAL '1 minute'
          WHERE signal_id = '${signalId}';`
      );
      const current = await claimDueRecipients("stale-b", 5, 90);
      expect(current.map((row) => row.recipientId).sort()).toEqual(
        original.map((row) => row.recipientId).sort()
      );

      const target = current[0].recipientId;
      expect(await markRecipientSent(target, "stale-a")).toBe(false);
      const staleFailure = await markRecipientFailed(
        target,
        "stale-a",
        {
          code: "SMTP_TIMEOUT",
          message: "The SMTP server did not respond in time.",
        },
        60
      );
      expect(staleFailure).toEqual({ applied: false, terminal: false, attempts: 0 });
      expect(
        await markRecipientSkipped(target, "stale-a", {
          code: "RECIPIENT_INACTIVE",
          message: "The recipient account is not active.",
        })
      ).toBe(false);

      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE recipient_id = '${target}'
              AND email_status = 'SENDING'
              AND email_lease_owner = 'stale-b'
              AND email_attempts = 0
              AND email_sent_at IS NULL
              AND email_error IS NULL;`
        )
      ).toBe(1);
      expect(await attemptsFor(signalId)).toBe(0);

      // The current owner can complete the same row.
      expect(await markRecipientSent(target, "stale-b")).toBe(true);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE recipient_id = '${target}'
              AND email_status = 'SENT'
              AND email_attempts = 1
              AND email_sent_at IS NOT NULL
              AND email_lease_owner IS NULL
              AND email_lease_expires_at IS NULL;`
        )
      ).toBe(1);
      expect(await attemptsFor(signalId)).toBe(1);
    });

    // 6 ─ Database failure during dispatch
    it("keeps a recipient recoverable when the completion statement fails", async () => {
      const { signalId } = await publish({
        message: "DB failure",
        audience: { mode: "SELECTED", userIds: [recipients[0]] },
        idempotencyKey: key("s71-db-failure"),
      });
      const target = String(
        await scalar(
          `SELECT recipient_id FROM signal_recipients
            WHERE signal_id = '${signalId}';`
        )
      );

      await dbQuery(
        `CREATE OR REPLACE FUNCTION s71_block_attempt() RETURNS trigger AS $$
         BEGIN
           IF NEW.recipient_id = '${target}'::uuid THEN
             RAISE EXCEPTION 'injected attempt failure';
           END IF;
           RETURN NEW;
         END;
         $$ LANGUAGE plpgsql;
         DROP TRIGGER IF EXISTS s71_block_attempt ON signal_email_attempts;
         CREATE TRIGGER s71_block_attempt
           BEFORE INSERT ON signal_email_attempts
           FOR EACH ROW EXECUTE FUNCTION s71_block_attempt();`
      );

      const firstSend: string[] = [];
      try {
        await expect(
          dispatchDueSignals({
            config: EMAIL_CONFIG,
            transport: fakeTransport(firstSend),
            owner: "db-fail-owner",
          })
        ).rejects.toThrow(/injected attempt failure/);
      } finally {
        await dbQuery(
          `DROP TRIGGER IF EXISTS s71_block_attempt ON signal_email_attempts;
           DROP FUNCTION IF EXISTS s71_block_attempt();`
        );
      }

      // The statement rolled back as a unit: no attempt, no SENT, still leased.
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'SENDING'
              AND email_attempts = 0
              AND email_lease_owner = 'db-fail-owner'
              AND email_sent_at IS NULL
              AND email_error IS NULL;`
        )
      ).toBe(1);
      expect(await attemptsFor(signalId)).toBe(0);
      // SMTP accepted the message before the database write failed.
      expect(firstSend).toHaveLength(1);
      expect(
        await count(`SELECT count(*) FROM signals WHERE signal_id = '${signalId}';`)
      ).toBe(1);

      // Lease expiry lets a later dispatcher finish the row.
      await dbQuery(
        `UPDATE signal_recipients
            SET email_lease_expires_at = NOW() - INTERVAL '1 minute'
          WHERE signal_id = '${signalId}';`
      );
      const secondSend: string[] = [];
      const recovered = await dispatchDueSignals({
        config: EMAIL_CONFIG,
        transport: fakeTransport(secondSend),
        owner: "recovery-owner",
      });
      expect(recovered).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
      expect(secondSend).toHaveLength(1);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'SENT'
              AND email_attempts = 1
              AND email_sent_at IS NOT NULL;`
        )
      ).toBe(1);
      expect(await attemptsFor(signalId)).toBe(1);
    });

    it("leaves the queue untouched when the claim statement fails", async () => {
      const { signalId } = await publish({
        message: "Claim failure",
        audience: { mode: "SELECTED", userIds: [recipients[0]] },
        idempotencyKey: key("s71-claim-failure"),
      });

      const globals = globalThis as { __signalsRepoTestSql?: unknown };
      const original = globals.__signalsRepoTestSql;
      expect(original).toBe(psqlTag);
      globals.__signalsRepoTestSql = (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        if (strings.join("?").includes("FOR UPDATE SKIP LOCKED")) {
          throw new Error("injected claim failure");
        }
        return psqlTag(strings, ...values);
      };

      try {
        await expect(
          dispatchDueSignals({
            config: EMAIL_CONFIG,
            transport: fakeTransport(),
            owner: "claim-fail-owner",
          })
        ).rejects.toThrow(/injected claim failure/);
      } finally {
        globals.__signalsRepoTestSql = original;
      }

      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'PENDING'
              AND email_attempts = 0
              AND email_lease_owner IS NULL
              AND email_lease_expires_at IS NULL
              AND email_last_attempt_at IS NULL;`
        )
      ).toBe(1);
      expect(await attemptsFor(signalId)).toBe(0);
      expect(await claimDueRecipients("after-failure", 5, 90)).toHaveLength(1);
    });

    // 7 ─ Idempotent replay
    it("does not dispatch when an identical publication is replayed", async () => {
      const body = {
        message: "Replay safe",
        audience: {
          mode: "SELECTED" as const,
          userIds: [recipients[0], recipients[1]],
        },
        idempotencyKey: key("s71-replay"),
      };
      const sent: string[] = [];
      let dispatches = 0;

      // Mirrors the publish route: dispatch only for a genuinely new signal.
      async function publishLikeRoute(): Promise<string> {
        const publication = await publish(body);
        if (!publication.reused) {
          dispatches += 1;
          await dispatchPublishedSignal(publication.signalId, {
            resolveConfig: configOk,
            createTransport: () => fakeTransport(sent),
          });
        }
        return publication.signalId;
      }

      const signalId = await publishLikeRoute();
      expect(dispatches).toBe(1);
      expect(sent).toHaveLength(2);
      expect(await attemptsFor(signalId)).toBe(2);

      const replayedId = await publishLikeRoute();
      expect(replayedId).toBe(signalId);
      expect(dispatches).toBe(1);
      expect(sent).toHaveLength(2);
      expect(await attemptsFor(signalId)).toBe(2);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}';`
        )
      ).toBe(2);

      // A key reused with different content is rejected and dispatches nothing.
      await expect(
        publish({ ...body, message: "Replay with edits" })
      ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
      expect(dispatches).toBe(1);
      expect(sent).toHaveLength(2);
      expect(await attemptsFor(signalId)).toBe(2);
      expect(
        await count(`SELECT count(*) FROM signals WHERE signal_id = '${signalId}';`)
      ).toBe(1);
    });

    // Configuration failure must never look like delivery
    it("reports queued recipients and creates no transport when SMTP is unconfigured", async () => {
      const { signalId } = await publish({
        message: "No SMTP",
        audience: { mode: "SELECTED", userIds: [recipients[0], recipients[1]] },
        idempotencyKey: key("s71-no-smtp"),
      });

      let transportCreated = false;
      const delivery = await dispatchPublishedSignal(signalId, {
        resolveConfig: () => ({
          ok: false,
          problems: ["SIGNALS_SMTP_HOST is missing."],
        }),
        createTransport: () => {
          transportCreated = true;
          throw new Error("transport must not be created");
        },
      });

      expect(delivery).toEqual({
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        pending: 2,
        status: "EMAIL_NOT_CONFIGURED",
      });
      expect(transportCreated).toBe(false);
      expect(
        await count(
          `SELECT count(*) FROM signal_recipients
            WHERE signal_id = '${signalId}'
              AND email_status = 'PENDING'
              AND email_attempts = 0
              AND email_lease_owner IS NULL;`
        )
      ).toBe(2);
      expect(await attemptsFor(signalId)).toBe(0);
    });
  });
});
