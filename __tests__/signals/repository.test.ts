/**
 * Signals repository SQL contracts.
 *
 * A scripted fake stands in for the Neon HTTP driver. It records the exact
 * statements the repository issues, so these tests pin the properties that
 * matter for this phase: one atomic publication statement, eligibility
 * predicates resolved in SQL, idempotency guards, retry scoping and the
 * absence of full email lists from history responses.
 *
 * No database connection is created and no SQL is executed.
 */

import {
  findPublicationById,
  findPublicationByIdempotencyKey,
  findSignalDetail,
  listEligibleRecipients,
  listSignalHistory,
  publishSignal,
  retryFailedRecipients,
} from "@/lib/signals/repository";
import type { AppUser } from "@/lib/auth/types";

const globalStore = globalThis as typeof globalThis & {
  __signalsDb?: unknown;
};

jest.mock("@/lib/db", () => ({
  getDb: () => globalStore.__signalsDb,
}));

interface SqlCall {
  text: string;
  values: unknown[];
}

class FakeSignalsDb {
  calls: SqlCall[] = [];
  responses: unknown[][] = [];
  failNext: unknown = null;

  reset(): void {
    this.calls = [];
    this.responses = [];
    this.failNext = null;
  }

  private record(text: string, values: unknown[]): Promise<unknown[]> {
    this.calls.push({ text, values });
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    return Promise.resolve(this.responses.shift() ?? []);
  }

  sql = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.reduce(
      (acc, part, index) =>
        acc + part + (index < values.length ? `$${index + 1}` : ""),
      ""
    );
    return this.record(text, values);
  };

  query = (text: string, values: unknown[] = []): Promise<unknown[]> =>
    this.record(text, values);
}

const fake = new FakeSignalsDb();

const ACTOR_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ID_A = "bbbbbbbb-2222-4222-8222-222222222222";
const ID_B = "cccccccc-3333-4333-8333-333333333333";
const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";
const FINGERPRINT = "a".repeat(64);

const ACTOR: AppUser = {
  userId: ACTOR_ID,
  email: "root@example.com",
  displayName: "Root",
  role: "SUPER_ADMIN",
  status: "ACTIVE",
};

function publishRow(overrides: Record<string, unknown> = {}) {
  return {
    created_signal_id: SIGNAL_ID,
    existing_signal_id: null,
    requested_count: 2,
    eligible_count: 2,
    existing_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
  globalStore.__signalsDb = fake.sql;
});

describe("eligible recipient discovery", () => {
  it("queries only ACTIVE CUSTOMER rows with a bounded, escaped search", async () => {
    fake.responses.push([
      {
        user_id: ID_A,
        email: "a@example.com",
        display_name: "A",
      },
      {
        user_id: ID_B,
        email: "b@example.com",
        display_name: "B",
      },
      {
        user_id: "eeeeeeee-5555-4555-8555-555555555555",
        email: "c@example.com",
        display_name: "C",
      },
    ]);

    const page = await listEligibleRecipients("ravi%_", 2);
    expect(page.recipients).toEqual([
      { userId: ID_A, email: "a@example.com", displayName: "A" },
      { userId: ID_B, email: "b@example.com", displayName: "B" },
    ]);
    expect(page.hasMore).toBe(true);

    const call = fake.calls[0];
    expect(call.text).toContain("role = 'CUSTOMER'");
    expect(call.text).toContain("status = 'ACTIVE'");
    expect(call.text).toContain("ILIKE");
    expect(call.text).not.toMatch(/customer_subscriptions|is_subscription_entitled/i);
    expect(call.values).toContain("%ravi\\%\\_%");
    expect(call.values).toContain(3);
  });
});

describe("atomic publication", () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      signalId: SIGNAL_ID,
      actorUserId: ACTOR_ID,
      message: "  exact\nmessage 🔥  ",
      audience: { mode: "SELECTED" as const, userIds: [ID_A, ID_B] },
      idempotencyKey: "key-1",
      idempotencyFingerprint: FINGERPRINT,
      ...overrides,
    };
  }

  it("writes signal, recipients, snapshot email and audit in one statement", async () => {
    fake.responses.push([publishRow()]);

    const input = params();
    const outcome = await publishSignal(input);
    expect(outcome).toEqual({ kind: "created", signalId: SIGNAL_ID });
    expect(fake.calls).toHaveLength(1);

    const { text, values } = fake.calls[0];
    expect(text).toContain("INSERT INTO signals");
    expect(text).toContain("INSERT INTO signal_recipients");
    expect(text).toContain("INSERT INTO admin_audit_log");
    expect(text).toContain("'SIGNAL_PUBLISHED'");
    expect(text).toContain("ON CONFLICT (created_by, idempotency_key)");
    expect(text).toContain("idempotency_fingerprint");
    expect(text).toContain("SELECT DISTINCT unnest");
    expect(text).toContain("u.role = 'CUSTOMER'");
    expect(text).toContain("u.status = 'ACTIVE'");
    expect(text).not.toMatch(/u\.(role|status)\s+IN\s*\(/);
    expect(text).toContain("email_address");
    expect(text).not.toMatch(/customer_subscriptions|is_subscription_entitled/i);

    expect(values).toContain("key-1");
    expect(values).toContain(FINGERPRINT);
    expect(values).toContain(ACTOR_ID);
    expect(values).toContain(SIGNAL_ID);
    expect(values).toContain("  exact\nmessage 🔥  ");
    expect(values).toContain((input.audience as { userIds: string[] }).userIds);
    expect(values).toContain(1000);
  });

  it("resolves ALL_ELIGIBLE recipients server-side", async () => {
    fake.responses.push([publishRow({ requested_count: 3, eligible_count: 3 })]);

    const outcome = await publishSignal(
      params({
        audience: { mode: "ALL_ELIGIBLE" as const },
        idempotencyKey: null,
        idempotencyFingerprint: null,
      })
    );
    expect(outcome.kind).toBe("created");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].text).toContain("'ALL_ELIGIBLE'");
    expect(fake.calls[0].values).toContain(1000);
  });

  it("reports a selected-id mismatch without writing anything", async () => {
    fake.responses.push([
      publishRow({
        created_signal_id: null,
        requested_count: 2,
        eligible_count: 1,
      }),
    ]);

    const outcome = await publishSignal(params());
    expect(outcome).toEqual({
      kind: "recipient_mismatch",
      requestedCount: 2,
      eligibleCount: 1,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("reports empty and oversized all-eligible audiences", async () => {
    fake.responses.push([
      publishRow({ created_signal_id: null, requested_count: 0, eligible_count: 0 }),
    ]);
    const perRequest = { mode: "ALL_ELIGIBLE" as const };
    expect(await publishSignal(params({ audience: perRequest }))).toEqual({
      kind: "no_recipients",
    });

    fake.responses.push([
      publishRow({
        created_signal_id: null,
        requested_count: 1001,
        eligible_count: 1001,
      }),
    ]);
    expect(await publishSignal(params({ audience: perRequest }))).toEqual({
      kind: "too_many_recipients",
      eligibleCount: 1001,
    });
  });

  it("returns an already-committed signal for the same key", async () => {
    fake.responses.push([
      publishRow({ created_signal_id: null, existing_signal_id: SIGNAL_ID }),
    ]);
    expect(await publishSignal(params())).toEqual({
      kind: "existing",
      signalId: SIGNAL_ID,
    });
  });

  it("reports a concurrent conflict when no row is visible yet", async () => {
    fake.responses.push([
      publishRow({
        created_signal_id: null,
        existing_signal_id: null,
        existing_count: 0,
      }),
    ]);
    expect(await publishSignal(params())).toEqual({ kind: "conflict" });
  });

  it("propagates a driver failure after exactly one statement", async () => {
    const failure = new Error("connection lost");
    fake.failNext = failure;

    await expect(publishSignal(params())).rejects.toBe(failure);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("idempotency lookup", () => {
  it("scopes the lookup to the creator and key", async () => {
    fake.responses.push([
      {
        signal_id: SIGNAL_ID,
        message: "hello",
        published_at: "2026-11-14T10:00:00.000Z",
        created_by: ACTOR_ID,
        status: "PUBLISHED",
        recipient_count: 7,
        idempotency_fingerprint: FINGERPRINT,
      },
    ]);

    const record = await findPublicationByIdempotencyKey(ACTOR_ID, "key-1");
    expect(record).toMatchObject({
      signalId: SIGNAL_ID,
      recipientCount: 7,
      publishedAt: "2026-11-14T10:00:00.000Z",
      idempotencyFingerprint: FINGERPRINT,
    });
    expect(fake.calls[0].text).toContain("created_by =");
    expect(fake.calls[0].text).toContain("idempotency_key =");
    expect(fake.calls[0].text).toContain("s.idempotency_fingerprint");
    expect(fake.calls[0].values).toContain(ACTOR_ID);
    expect(fake.calls[0].values).toContain("key-1");
  });

  it("returns null when the signal is gone", async () => {
    fake.responses.push([]);
    expect(await findPublicationById(SIGNAL_ID)).toBeNull();
  });
});

describe("history", () => {
  it("summarizes delivery and read state without recipient emails", async () => {
    fake.responses.push([
      {
        signal_id: SIGNAL_ID,
        message_preview: "First line next",
        published_at: "2026-11-14T10:00:00.000Z",
        status: "PUBLISHED",
        recipient_count: 10,
        pending_count: 1,
        sending_count: 2,
        sent_count: 5,
        failed_count: 1,
        skipped_count: 1,
        read_count: 4,
        unread_count: 6,
        total: 42,
      },
    ]);

    const page = await listSignalHistory(3, 10);
    expect(page).toEqual({
      page: 3,
      pageSize: 10,
      total: 42,
      signals: [
        {
          signalId: SIGNAL_ID,
          messagePreview: "First line next",
          publishedAt: "2026-11-14T10:00:00.000Z",
          status: "PUBLISHED",
          recipientCount: 10,
          delivery: { pending: 1, sending: 2, sent: 5, failed: 1, skipped: 1 },
          read: { read: 4, unread: 6 },
        },
      ],
    });

    const { text, values } = fake.calls[0];
    expect(text).toContain("message_preview");
    expect(text).not.toContain("email_address");
    expect(text).not.toContain("email_error");
    expect(values).toContain(10);
    expect(values).toContain(20); // OFFSET for page 3, size 10
  });
});

describe("detail", () => {
  it("returns recipients and sanitizes stored email errors", async () => {
    fake.responses.push([
      {
        signal_id: SIGNAL_ID,
        message: "  exact body  ",
        published_at: "2026-11-14T10:00:00.000Z",
        created_at: "2026-11-14T09:59:59.000Z",
        status: "PUBLISHED",
        created_by: ACTOR_ID,
        creator_email: "root@example.com",
        creator_display_name: "Root",
        recipient_count: 1,
        pending_count: 0,
        sending_count: 0,
        sent_count: 1,
        failed_count: 0,
        skipped_count: 0,
        read_count: 1,
        unread_count: 0,
      },
    ]);
    fake.responses.push([
      {
        recipient_id: "ffffffff-6666-4666-8666-666666666666",
        user_id: ID_A,
        email_address: "a@example.com",
        display_name: "A",
        read_at: "2026-11-14T11:00:00.000Z",
        email_status: "SENT",
        email_attempts: 2,
        email_last_attempt_at: "2026-11-14T10:30:00.000Z",
        email_sent_at: "2026-11-14T10:30:00.000Z",
        email_error: "SMTP\nfailed\u0000 at host",
      },
    ]);

    const detail = await findSignalDetail(SIGNAL_ID);
    expect(detail).toMatchObject({
      signalId: SIGNAL_ID,
      message: "  exact body  ",
      createdBy: {
        userId: ACTOR_ID,
        email: "root@example.com",
        displayName: "Root",
      },
      delivery: { pending: 0, sending: 0, sent: 1, failed: 0, skipped: 0 },
      read: { read: 1, unread: 0 },
    });
    expect(detail?.recipients).toEqual([
      {
        recipientId: "ffffffff-6666-4666-8666-666666666666",
        userId: ID_A,
        email: "a@example.com",
        displayName: "A",
        readAt: "2026-11-14T11:00:00.000Z",
        emailStatus: "SENT",
        emailAttempts: 2,
        emailLastAttemptAt: "2026-11-14T10:30:00.000Z",
        emailSentAt: "2026-11-14T10:30:00.000Z",
        emailError: "SMTP failed at host",
      },
    ]);
    expect(fake.calls[1].text).toContain("email_address");
    expect(fake.calls[1].text).toContain("WHERE r.signal_id =");
    expect(fake.calls[1].text).not.toMatch(/password|token|credential/i);
  });

  it("returns null for an unknown signal", async () => {
    fake.responses.push([]);
    expect(await findSignalDetail(SIGNAL_ID)).toBeNull();
  });
});

describe("retry", () => {
  it("requeues only FAILED rows whose customer is still active, with audit", async () => {
    fake.responses.push([{ signal_found: 1, retried_count: 3 }]);

    const result = await retryFailedRecipients(ACTOR, SIGNAL_ID);
    expect(result).toEqual({ signalFound: true, retriedCount: 3 });
    expect(fake.calls).toHaveLength(1);

    const { text, values } = fake.calls[0];
    expect(text).toContain("r.email_status = 'FAILED'");
    expect(text).toContain("SET email_status = 'PENDING'");
    // The update repeats the status predicate so a row that became SENDING
    // after the snapshot is never reset.
    expect(text.match(/email_status = 'FAILED'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("email_lease_owner = NULL");
    expect(text).toContain("email_lease_expires_at = NULL");
    expect(text).toContain("'SIGNAL_EMAIL_RETRY_REQUESTED'");
    expect(text).toContain("u.role = 'CUSTOMER'");
    expect(text).toContain("u.status = 'ACTIVE'");
    expect(text).not.toContain("'SENDING'");
    expect(text).not.toContain("'SKIPPED'");
    expect(values).toContain(ACTOR_ID);
    expect(values).toContain(SIGNAL_ID);
  });

  it("reports a missing signal without touching recipients", async () => {
    fake.responses.push([{ signal_found: 0, retried_count: 0 }]);
    expect(await retryFailedRecipients(ACTOR, SIGNAL_ID)).toEqual({
      signalFound: false,
      retriedCount: 0,
    });
  });
});
