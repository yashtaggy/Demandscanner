/**
 * Outbox SQL contracts. A scripted fake stands in for the Neon HTTP driver, so
 * these tests pin the atomicity, lease guards, due-work predicates, attempt
 * history and diagnostic sanitisation without opening a database connection.
 */

import {
  claimDueRecipients,
  findRecipientAccount,
  markRecipientFailed,
  markRecipientSent,
  markRecipientSkipped,
} from "@/lib/signals/delivery-repository";

const globalStore = globalThis as typeof globalThis & {
  __deliveryDb?: unknown;
};

jest.mock("@/lib/db", () => ({
  getDb: () => globalStore.__deliveryDb,
}));

interface SqlCall {
  text: string;
  values: unknown[];
}

class FakeDb {
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

const fake = new FakeDb();

const RECIPIENT_ID = "eeeeeeee-5555-4555-8555-555555555555";
const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";
const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OWNER = "dispatcher-owner-1";

beforeEach(() => {
  fake.reset();
  globalStore.__deliveryDb = fake.sql;
});

describe("claiming due work", () => {
  it("claims due PENDING rows and expired SENDING leases atomically", async () => {
    fake.responses.push([
      {
        recipient_id: RECIPIENT_ID,
        signal_id: SIGNAL_ID,
        user_id: USER_ID,
        email_address: "customer@example.com",
        email_attempts: 2,
        message: "Hello\nWorld",
      },
    ]);

    const claims = await claimDueRecipients(OWNER, 5, 90);
    expect(claims).toEqual([
      {
        recipientId: RECIPIENT_ID,
        signalId: SIGNAL_ID,
        userId: USER_ID,
        emailAddress: "customer@example.com",
        priorAttempts: 2,
        message: "Hello\nWorld",
      },
    ]);

    const call = fake.calls[0];
    expect(call.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(call.text).toContain("email_status = 'PENDING'");
    expect(call.text).toContain("email_next_attempt_at <= NOW()");
    expect(call.text).toContain("email_status = 'SENDING'");
    expect(call.text).toContain("email_lease_expires_at <= NOW()");
    expect(call.text).toContain("email_attempts < $1");
    expect(call.text).toContain("JOIN signals");
    expect(call.values).toEqual([5, 5, OWNER, 90]);
  });

  it("re-reads the recipient account immediately before each send", async () => {
    fake.responses.push([{ role: "CUSTOMER", status: "ACTIVE" }]);
    await expect(findRecipientAccount(USER_ID)).resolves.toEqual({
      role: "CUSTOMER",
      status: "ACTIVE",
    });
    expect(fake.calls[0].text).toContain("FROM app_users");
    expect(fake.calls[0].values).toEqual([USER_ID]);

    fake.responses.push([]);
    await expect(findRecipientAccount(USER_ID)).resolves.toBeNull();
  });
});

describe("SENT transition", () => {
  it("updates only the owned lease and records the attempt in one statement", async () => {
    fake.responses.push([{ updated_count: 1, final_status: null, final_attempts: 0 }]);
    await expect(markRecipientSent(RECIPIENT_ID, OWNER)).resolves.toBe(true);

    const call = fake.calls[0];
    expect(call.text).toContain("email_status = 'SENT'");
    expect(call.text).toContain("email_sent_at = NOW()");
    expect(call.text).toContain("email_lease_owner = $2");
    expect(call.text).toContain("INSERT INTO signal_email_attempts");
    expect(call.text).toContain("'SENT'");
    expect(call.values).toEqual([RECIPIENT_ID, OWNER]);
  });

  it("reports a lost lease when no SENDING row is owned by this dispatcher", async () => {
    fake.responses.push([{ updated_count: 0, final_status: null, final_attempts: 0 }]);
    await expect(markRecipientSent(RECIPIENT_ID, "other-owner")).resolves.toBe(false);
  });
});

describe("FAILED transition", () => {
  it("returns to PENDING with backoff and sanitized diagnostics", async () => {
    fake.responses.push([
      { updated_count: 1, final_status: "PENDING", final_attempts: 2 },
    ]);

    const diagnosticMessage = `SMTP\n\tfailed\u0000 ${"x".repeat(600)}`;
    const result = await markRecipientFailed(
      RECIPIENT_ID,
      OWNER,
      { code: "SMTP\nCODE\u0000", message: diagnosticMessage },
      120
    );

    expect(result).toEqual({ applied: true, terminal: false, attempts: 2 });
    const call = fake.calls[0];
    expect(call.text).toContain("THEN 'FAILED'");
    expect(call.text).toContain("ELSE 'PENDING'");
    expect(call.text).toContain("INSERT INTO signal_email_attempts");
    expect(call.text).toContain("'FAILED'");

    // 1 max attempt, 2 max attempt, 3 delay, 4 error, 5 id, 6 owner,
    // 7 code, 8 error.
    expect(call.values[2]).toBe(120);
    const storedMessage = String(call.values[3]);
    expect(storedMessage).toBe(String(call.values[7]));
    expect(storedMessage.length).toBeLessThanOrEqual(500);
    expect(storedMessage.startsWith("SMTP failed x")).toBe(true);
    expect(storedMessage).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    expect(call.values[6]).toBe("SMTP CODE");
  });

  it("makes the fifth failure terminal", async () => {
    fake.responses.push([
      { updated_count: 1, final_status: "FAILED", final_attempts: 5 },
    ]);
    const result = await markRecipientFailed(
      RECIPIENT_ID,
      OWNER,
      { code: "SMTP_DELIVERY_FAILED", message: "failed" },
      960
    );
    expect(result).toEqual({ applied: true, terminal: true, attempts: 5 });
  });

  it("does not record an attempt when the lease was lost", async () => {
    fake.responses.push([
      { updated_count: 0, final_status: null, final_attempts: 0 },
    ]);
    await expect(
      markRecipientFailed(
        RECIPIENT_ID,
        "stale-owner",
        { code: "SMTP_TIMEOUT", message: "timeout" },
        60
      )
    ).resolves.toEqual({ applied: false, terminal: false, attempts: 0 });
  });
});

describe("SKIPPED transition", () => {
  it("marks the outbox row and appends a sanitized SKIPPED attempt", async () => {
    fake.responses.push([{ updated_count: 1, final_status: null, final_attempts: 0 }]);
    await expect(
      markRecipientSkipped(RECIPIENT_ID, OWNER, {
        code: "RECIPIENT_SUSPENDED",
        message: "The recipient account is suspended.",
      })
    ).resolves.toBe(true);

    const call = fake.calls[0];
    expect(call.text).toContain("email_status = 'SKIPPED'");
    expect(call.text).toContain("'SKIPPED'");
    expect(call.values).toEqual([
      "The recipient account is suspended.",
      RECIPIENT_ID,
      OWNER,
      "RECIPIENT_SUSPENDED",
      "The recipient account is suspended.",
    ]);
  });
});

describe("signal integrity", () => {
  it("never writes to the signals table from delivery statements", async () => {
    fake.responses.push(
      [{ updated_count: 1, final_status: "PENDING", final_attempts: 1 }],
      [{ updated_count: 1, final_status: null, final_attempts: 0 }],
      [{ updated_count: 1, final_status: null, final_attempts: 0 }],
      []
    );

    await claimDueRecipients(OWNER);
    await markRecipientSent(RECIPIENT_ID, OWNER);
    await markRecipientFailed(
      RECIPIENT_ID,
      OWNER,
      { code: "SMTP_TIMEOUT", message: "The SMTP server did not respond in time." },
      60
    );
    await markRecipientSkipped(RECIPIENT_ID, OWNER, {
      code: "RECIPIENT_DISABLED",
      message: "The recipient account is disabled.",
    });

    for (const call of fake.calls) {
      expect(call.text).not.toMatch(
        /(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+signals\b/i
      );
    }
  });
});
