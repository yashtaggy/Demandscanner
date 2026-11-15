/**
 * Dispatcher rules with the outbox repository mocked and a fake transport.
 * No database statement is executed and no SMTP connection is created.
 */

jest.mock("@/lib/signals/delivery-repository", () => ({
  DISPATCH_BATCH_SIZE: 5,
  DISPATCH_LEASE_SECONDS: 90,
  claimDueRecipients: jest.fn(),
  findRecipientAccount: jest.fn(),
  markRecipientSent: jest.fn(),
  markRecipientFailed: jest.fn(),
  markRecipientSkipped: jest.fn(),
}));

import type { SignalsEmailConfig } from "@/lib/signals/email-config";
import type { SignalsEmailTransport } from "@/lib/signals/email-transport";
import { SMTP_ATTEMPT_TIMEOUT_MS } from "@/lib/signals/email-transport";
import * as repo from "@/lib/signals/delivery-repository";
import {
  DISPATCH_COMPLETION_RESERVE_MS,
  dispatchDueSignals,
} from "@/lib/signals/dispatcher";

const mocked = repo as jest.Mocked<typeof repo>;

const RECIPIENT_A = "eeeeeeee-5555-4555-8555-555555555555";
const RECIPIENT_B = "ffffffff-6666-4666-8666-666666666666";
const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";
const USER_A = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_B = "bbbbbbbb-2222-4222-8222-222222222222";
const OWNER = "dispatcher-test-owner";

const CONFIG: SignalsEmailConfig = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "signals@example.com",
  password: "app-password-secret",
  fromName: "DemandScan Signals",
  fromAddress: "signals@example.com",
  replyTo: null,
  footer: "Automated message.",
  appUrl: "https://app.example.com",
};

function claim(overrides: Partial<repo.ClaimedRecipient> = {}): repo.ClaimedRecipient {
  return {
    recipientId: RECIPIENT_A,
    signalId: SIGNAL_ID,
    userId: USER_A,
    emailAddress: "customer@example.com",
    priorAttempts: 0,
    message: "Buy NIFTY\n\nat 10:30 🚀",
    ...overrides,
  };
}

function transportWith(
  sendMail: jest.Mock = jest.fn().mockResolvedValue({ accepted: ["customer@example.com"] })
): SignalsEmailTransport & { sendMail: jest.Mock; close: jest.Mock } {
  return { sendMail, close: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.claimDueRecipients.mockResolvedValue([]);
  mocked.findRecipientAccount.mockResolvedValue({ role: "CUSTOMER", status: "ACTIVE" });
  mocked.markRecipientSent.mockResolvedValue(true);
  mocked.markRecipientFailed.mockResolvedValue({
    applied: true,
    terminal: false,
    attempts: 1,
  });
  mocked.markRecipientSkipped.mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("delivery to eligible recipients", () => {
  it("sends to an ACTIVE CUSTOMER and records SENT", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    const transport = transportWith();

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
      batchSize: 5,
    });

    expect(summary).toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      terminalFailures: 0,
      skipped: 0,
      leaseLost: 0,
      deferred: 0,
    });
    expect(mocked.findRecipientAccount).toHaveBeenCalledWith(USER_A);
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(mocked.markRecipientSent).toHaveBeenCalledWith(RECIPIENT_A, OWNER);
    expect(transport.close).toHaveBeenCalled();
  });

  it("formats a plain-text message with the footer and inbox link", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    const transport = transportWith();

    await dispatchDueSignals({ config: CONFIG, transport, owner: OWNER });

    const options = transport.sendMail.mock.calls[0][0];
    expect(options.subject).toBe("Buy NIFTY");
    expect(options.text).toBe(
      "Buy NIFTY\n\nat 10:30 🚀\n\nAutomated message.\n\n" +
        `View this signal in DemandScan:\nhttps://app.example.com/signals/${SIGNAL_ID}`
    );
    expect(options.text).not.toContain("<html");
    expect(options.from).toEqual({
      name: "DemandScan Signals",
      address: "signals@example.com",
    });
  });

  it("uses a deterministic Message-ID derived from signal and recipient", async () => {
    mocked.claimDueRecipients
      .mockResolvedValueOnce([claim()])
      .mockResolvedValueOnce([claim()]);
    const transport = transportWith();

    await dispatchDueSignals({ config: CONFIG, transport, owner: OWNER });
    await dispatchDueSignals({ config: CONFIG, transport, owner: OWNER });

    const first = transport.sendMail.mock.calls[0][0].messageId;
    const second = transport.sendMail.mock.calls[1][0].messageId;
    expect(first).toBe(second);
    expect(first).toBe(
      `<signal.${SIGNAL_ID}.recipient.${RECIPIENT_A}@example.com>`
    );
  });

  it("keeps the summary free of addresses, messages and credentials", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport: transportWith(),
      owner: OWNER,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("Buy NIFTY");
    expect(serialized).not.toContain("app-password-secret");
    expect(serialized).not.toContain("smtp.gmail.com");
  });
});

describe("ineligible recipients", () => {
  it.each([
    [{ role: "CUSTOMER", status: "SUSPENDED" }, "RECIPIENT_SUSPENDED"],
    [{ role: "CUSTOMER", status: "DISABLED" }, "RECIPIENT_DISABLED"],
    [{ role: "ADMIN", status: "ACTIVE" }, "RECIPIENT_NOT_CUSTOMER"],
    [{ role: "SUPER_ADMIN", status: "ACTIVE" }, "RECIPIENT_NOT_CUSTOMER"],
    [null, "RECIPIENT_NOT_FOUND"],
  ] as const)("marks %p as SKIPPED without sending", async (account, code) => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    mocked.findRecipientAccount.mockResolvedValue(account as repo.RecipientAccount | null);
    const transport = transportWith();

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
    });

    expect(summary).toMatchObject({ skipped: 1, sent: 0 });
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(mocked.markRecipientSkipped).toHaveBeenCalledWith(
      RECIPIENT_A,
      OWNER,
      expect.objectContaining({ code })
    );
    expect(mocked.markRecipientSent).not.toHaveBeenCalled();
  });
});

describe("failures and retries", () => {
  it("records a sanitized failure and schedules the first backoff", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim({ priorAttempts: 0 })]);
    const transport = transportWith(
      jest.fn().mockRejectedValue(
        Object.assign(new Error("535 app-password-secret at smtp.gmail.com"), {
          code: "EAUTH",
        })
      )
    );

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
    });

    expect(summary).toMatchObject({ failed: 1, terminalFailures: 0, sent: 0 });
    expect(mocked.markRecipientFailed).toHaveBeenCalledWith(
      RECIPIENT_A,
      OWNER,
      {
        code: "SMTP_AUTH_FAILED",
        message: "The SMTP server rejected the configured credentials.",
      },
      60
    );
    expect(JSON.stringify(mocked.markRecipientFailed.mock.calls)).not.toContain(
      "app-password-secret"
    );
    expect(mocked.markRecipientSent).not.toHaveBeenCalled();
  });

  it("makes the fifth failed attempt terminal", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim({ priorAttempts: 4 })]);
    mocked.markRecipientFailed.mockResolvedValue({
      applied: true,
      terminal: true,
      attempts: 5,
    });
    const transport = transportWith(
      jest.fn().mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
    );

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
    });

    expect(summary).toMatchObject({ failed: 1, terminalFailures: 1 });
    expect(mocked.markRecipientFailed.mock.calls[0][3]).toBe(960);
  });

  it("continues with the next recipient when one send fails", async () => {
    mocked.claimDueRecipients.mockResolvedValue([
      claim(),
      claim({
        recipientId: RECIPIENT_B,
        userId: USER_B,
        emailAddress: "second@example.com",
      }),
    ]);
    const transport = transportWith(
      jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "ECONNECTION" }))
        .mockResolvedValueOnce({ accepted: ["second@example.com"] })
    );

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
    });

    expect(summary).toMatchObject({ claimed: 2, failed: 1, sent: 1 });
    expect(mocked.markRecipientSent).toHaveBeenCalledWith(RECIPIENT_B, OWNER);
  });

  it("counts transitions refused by a newer lease as leaseLost", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    mocked.markRecipientSent.mockResolvedValue(false);

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport: transportWith(),
      owner: OWNER,
    });

    expect(summary).toMatchObject({ sent: 0, leaseLost: 1 });
  });
});

describe("bounded execution", () => {
  it("does not start work after the time budget is exhausted", async () => {
    mocked.claimDueRecipients.mockResolvedValue([
      claim(),
      claim({ recipientId: RECIPIENT_B, userId: USER_B }),
    ]);
    const transport = transportWith();
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(2_000);
    const onUnattempted = jest.fn().mockResolvedValue(undefined);

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
      timeBudgetMs: 1_000,
      onUnattempted,
    });
    now.mockRestore();

    expect(summary).toMatchObject({ claimed: 2, deferred: 2, sent: 0 });
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(onUnattempted).toHaveBeenCalledTimes(1);
    expect(
      (onUnattempted.mock.calls[0][0] as repo.ClaimedRecipient[]).map(
        (recipient) => recipient.recipientId
      )
    ).toEqual([RECIPIENT_A, RECIPIENT_B]);
  });

  it("keeps the run alive when releasing unattempted claims fails", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(2_000);

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport: transportWith(),
      owner: OWNER,
      timeBudgetMs: 1_000,
      onUnattempted: () => {
        throw new Error("release failed");
      },
    });
    now.mockRestore();

    expect(summary).toMatchObject({ claimed: 1, deferred: 1, sent: 0 });
  });

  it("claims only the requested signal", async () => {
    await dispatchDueSignals({
      config: CONFIG,
      transport: transportWith(),
      owner: OWNER,
      signalId: SIGNAL_ID,
    });
    expect(mocked.claimDueRecipients).toHaveBeenCalledWith(
      OWNER,
      5,
      90,
      SIGNAL_ID
    );
  });

  it("clamps the requested batch size", async () => {
    await dispatchDueSignals({
      config: CONFIG,
      transport: transportWith(),
      owner: OWNER,
      batchSize: 50,
    });
    expect(mocked.claimDueRecipients).toHaveBeenCalledWith(OWNER, 10, 90, null);
  });

  it("closes the transport even when claiming fails", async () => {
    mocked.claimDueRecipients.mockRejectedValue(new Error("database unavailable"));
    const transport = transportWith();

    await expect(
      dispatchDueSignals({ config: CONFIG, transport, owner: OWNER })
    ).rejects.toThrow("database unavailable");
    expect(transport.close).toHaveBeenCalled();
  });

  it("does not start an attempt that cannot finish before the deadline", async () => {
    mocked.claimDueRecipients.mockResolvedValue([
      claim(),
      claim({ recipientId: RECIPIENT_B, userId: USER_B }),
    ]);
    const transport = transportWith();
    jest.spyOn(Date, "now").mockReturnValue(10_000);
    const onUnattempted = jest.fn().mockResolvedValue(undefined);

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
      // One millisecond short of the attempt timeout plus the cleanup reserve.
      deadlineAt:
        10_000 + SMTP_ATTEMPT_TIMEOUT_MS + DISPATCH_COMPLETION_RESERVE_MS - 1,
      onUnattempted,
    });

    expect(summary).toMatchObject({ claimed: 2, deferred: 2, sent: 0 });
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(onUnattempted).toHaveBeenCalledTimes(1);
    expect(
      (onUnattempted.mock.calls[0][0] as repo.ClaimedRecipient[]).map(
        (recipient) => recipient.recipientId
      )
    ).toEqual([RECIPIENT_A, RECIPIENT_B]);
  });

  it("starts an attempt when the deadline still fits its full timeout", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    const transport = transportWith();
    jest.spyOn(Date, "now").mockReturnValue(10_000);

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
      deadlineAt:
        10_000 + SMTP_ATTEMPT_TIMEOUT_MS + DISPATCH_COMPLETION_RESERVE_MS,
    });

    expect(summary).toMatchObject({ claimed: 1, sent: 1, deferred: 0 });
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });

  it("keeps the scheduled dispatcher free of a deadline gate", async () => {
    mocked.claimDueRecipients.mockResolvedValue([claim()]);
    const transport = transportWith();

    const summary = await dispatchDueSignals({
      config: CONFIG,
      transport,
      owner: OWNER,
    });

    expect(summary).toMatchObject({ claimed: 1, sent: 1, deferred: 0 });
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
  });
});
