/**
 * Customer Signals repository SQL contracts.
 *
 * A scripted fake stands in for the Neon driver and records the exact
 * statements. These tests pin the properties that keep customer data scoped:
 * every statement filters on the session user id, only PUBLISHED signals are
 * visible, only read_at is written, and no delivery or email column is selected.
 *
 * No database connection is created and no SQL is executed.
 */

import {
  countCustomerUnread,
  findCustomerSignal,
  listCustomerInbox,
  setCustomerReadState,
} from "@/lib/signals/repository";

const globalStore = globalThis as typeof globalThis & {
  __customerDb?: unknown;
};

jest.mock("@/lib/db", () => ({
  getDb: () => globalStore.__customerDb,
}));

interface SqlCall {
  text: string;
  values: unknown[];
}

class FakeCustomerDb {
  calls: SqlCall[] = [];
  responses: unknown[][] = [];

  reset(): void {
    this.calls = [];
    this.responses = [];
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
    this.calls.push({ text, values });
    return Promise.resolve(this.responses.shift() ?? []);
  };
}

const fake = new FakeCustomerDb();

const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";

const FORBIDDEN_COLUMNS = [
  "email_address",
  "email_status",
  "email_error",
  "email_attempts",
  "email_lease_owner",
  "idempotency_key",
  "idempotency_fingerprint",
  "created_by",
];

beforeEach(() => {
  fake.reset();
  // getDb() must return the callable query function, not the recorder object.
  globalStore.__customerDb = fake.sql;
});

function lastSql(): string {
  return fake.calls[fake.calls.length - 1].text;
}

describe("listCustomerInbox", () => {
  it("scopes to the session user and to PUBLISHED signals", async () => {
    await listCustomerInbox(USER_ID, 2, 10);
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call.text).toContain("r.user_id = $1");
    expect(call.text).toContain("s.status = 'PUBLISHED'");
    expect(call.values[0]).toBe(USER_ID);
    expect(call.values).toEqual([USER_ID, 10, 10]);
    expect(call.text).toContain("LIMIT $2 OFFSET $3");
  });

  it("selects no delivery, email or administrative columns", async () => {
    await listCustomerInbox(USER_ID, 1, 20);
    const text = lastSql();
    for (const column of FORBIDDEN_COLUMNS) {
      expect(text).not.toContain(column);
    }
  });

  it("maps rows and derives isRead from read_at", async () => {
    fake.responses.push([
      {
        signal_id: SIGNAL_ID,
        message_preview: "hello",
        published_at: "2026-11-14T10:00:00.000Z",
        read_at: "2026-11-14T11:00:00.000Z",
        total: 2,
        unread_count: 1,
      },
      {
        signal_id: OTHER_ID,
        message_preview: "world",
        published_at: "2026-11-13T10:00:00.000Z",
        read_at: null,
        total: 2,
        unread_count: 1,
      },
    ]);

    const page = await listCustomerInbox(USER_ID, 1, 20);
    expect(page).toEqual({
      signals: [
        {
          signalId: SIGNAL_ID,
          messagePreview: "hello",
          publishedAt: "2026-11-14T10:00:00.000Z",
          readAt: "2026-11-14T11:00:00.000Z",
          isRead: true,
        },
        {
          signalId: OTHER_ID,
          messagePreview: "world",
          publishedAt: "2026-11-13T10:00:00.000Z",
          readAt: null,
          isRead: false,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      unreadCount: 1,
    });
  });

  it("keeps correct totals when the requested page is empty", async () => {
    fake.responses.push([
      {
        signal_id: null,
        message_preview: null,
        published_at: null,
        read_at: null,
        total: 3,
        unread_count: 2,
      },
    ]);

    const page = await listCustomerInbox(USER_ID, 9, 20);
    expect(page.signals).toEqual([]);
    expect(page.total).toBe(3);
    expect(page.unreadCount).toBe(2);
  });
});

describe("findCustomerSignal", () => {
  it("matches ownership and published status in the query", async () => {
    fake.responses.push([
      {
        signal_id: SIGNAL_ID,
        message: "  line 1\nline 2 🔥  ",
        published_at: "2026-11-14T10:00:00.000Z",
        read_at: null,
      },
    ]);

    const detail = await findCustomerSignal(USER_ID, SIGNAL_ID);
    const [call] = fake.calls;
    expect(call.text).toContain("r.user_id = $1");
    expect(call.text).toContain("s.signal_id = $2");
    expect(call.text).toContain("s.status = 'PUBLISHED'");
    expect(call.values).toEqual([USER_ID, SIGNAL_ID]);
    expect(detail).toEqual({
      signalId: SIGNAL_ID,
      message: "  line 1\nline 2 🔥  ",
      publishedAt: "2026-11-14T10:00:00.000Z",
      readAt: null,
      isRead: false,
    });
    for (const column of FORBIDDEN_COLUMNS) {
      expect(lastSql()).not.toContain(column);
    }
  });

  it("returns null when the signal is not assigned to this customer", async () => {
    await expect(findCustomerSignal(USER_ID, SIGNAL_ID)).resolves.toBeNull();
  });
});

describe("setCustomerReadState", () => {
  it("updates only read_at for the owned, published row", async () => {
    fake.responses.push([
      {
        signal_id: SIGNAL_ID,
        read_at: "2026-11-14T11:00:00.000Z",
      },
    ]);

    const state = await setCustomerReadState(USER_ID, SIGNAL_ID, true);
    const [call] = fake.calls;
    expect(call.text).toMatch(/UPDATE signal_recipients r\s+SET read_at =/);
    expect(call.text).toContain("r.user_id = $2");
    expect(call.text).toContain("r.signal_id = $3");
    expect(call.text).toMatch(/\$\d+::boolean/);
    expect(call.text).toContain("s.status = 'PUBLISHED'");
    expect(call.values).toEqual([true, USER_ID, SIGNAL_ID]);
    expect(state).toEqual({
      signalId: SIGNAL_ID,
      readAt: "2026-11-14T11:00:00.000Z",
      isRead: true,
    });
  });

  it("never writes email, retry or lease columns", async () => {
    await setCustomerReadState(USER_ID, SIGNAL_ID, false);
    const text = lastSql();
    const setClause = text.slice(text.indexOf("SET"), text.indexOf("WHERE"));
    expect(setClause).not.toMatch(/email_/);
    expect(setClause).not.toMatch(/recipient_id/);
    expect(setClause).not.toMatch(/user_id\s*=/);
  });

  it("preserves an existing read timestamp on a repeated read", async () => {
    await setCustomerReadState(USER_ID, SIGNAL_ID, true);
    expect(lastSql()).toContain("COALESCE(r.read_at, NOW())");
  });

  it("returns null when the update matched no owned row", async () => {
    await expect(
      setCustomerReadState(USER_ID, SIGNAL_ID, true)
    ).resolves.toBeNull();
  });
});

describe("countCustomerUnread", () => {
  it("counts the session user's unread published signals", async () => {
    fake.responses.push([{ unread_count: 5 }]);
    await expect(countCustomerUnread(USER_ID)).resolves.toBe(5);

    const [call] = fake.calls;
    expect(call.text).toContain("r.user_id = $1");
    expect(call.text).toContain("r.read_at IS NULL");
    expect(call.text).toContain("s.status = 'PUBLISHED'");
    expect(call.values).toEqual([USER_ID]);
  });

  it("returns 0 when the driver returns no row", async () => {
    await expect(countCustomerUnread(USER_ID)).resolves.toBe(0);
  });
});
