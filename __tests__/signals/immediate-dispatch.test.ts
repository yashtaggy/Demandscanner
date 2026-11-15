/**
 * Immediate dispatch after publication. The dispatcher, transport, config and
 * outbox queries are all injected, so nothing here opens a socket or a database
 * connection.
 */

import type { SignalsEmailConfig, SignalsEmailConfigResult } from "@/lib/signals/email-config";
import type { SignalsEmailTransport } from "@/lib/signals/email-transport";
import type { DispatchOptions, DispatchSummary } from "@/lib/signals/dispatcher";
import { dispatchDueSignals } from "@/lib/signals/dispatcher";
import {
  countPendingRecipients,
  releaseClaimedRecipients,
} from "@/lib/signals/delivery-repository";
import type { createSignalsEmailTransport } from "@/lib/signals/email-transport";
import {
  IMMEDIATE_DISPATCH_BATCH_SIZE,
  IMMEDIATE_DISPATCH_DEADLINE_MS,
  IMMEDIATE_DISPATCH_TIME_BUDGET_MS,
  dispatchPublishedSignal,
  type ImmediateDispatchDeps,
} from "@/lib/signals/immediate-dispatch";

const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";
const RECIPIENT_A = "eeeeeeee-5555-4555-8555-555555555555";
const RECIPIENT_B = "ffffffff-6666-4666-8666-666666666666";

const CONFIG: SignalsEmailConfig = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "signals@example.com",
  password: "app-password-secret",
  fromName: "DemandScan Signals",
  fromAddress: "signals@example.com",
  replyTo: null,
  footer: null,
  appUrl: "https://app.example.com",
};

function summary(overrides: Partial<DispatchSummary> = {}): DispatchSummary {
  return {
    claimed: 0,
    sent: 0,
    failed: 0,
    terminalFailures: 0,
    skipped: 0,
    leaseLost: 0,
    deferred: 0,
    ...overrides,
  };
}

let transport: SignalsEmailTransport;
let resolveConfig: jest.Mock;
let createTransport: jest.Mock;
let runDispatch: jest.Mock;
let countPending: jest.Mock;
let releaseClaims: jest.Mock;

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  transport = { sendMail: jest.fn(), close: jest.fn() };
  resolveConfig = jest.fn().mockReturnValue({ ok: true, config: CONFIG });
  createTransport = jest.fn().mockReturnValue(transport);
  runDispatch = jest.fn().mockResolvedValue(summary());
  countPending = jest.fn().mockResolvedValue(0);
  releaseClaims = jest.fn().mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function dispatch(overrides: ImmediateDispatchDeps = {}) {
  return dispatchPublishedSignal(SIGNAL_ID, {
    resolveConfig: resolveConfig as unknown as () => SignalsEmailConfigResult,
    createTransport: createTransport as unknown as typeof createSignalsEmailTransport,
    runDispatch: runDispatch as unknown as typeof dispatchDueSignals,
    countPending: countPending as unknown as typeof countPendingRecipients,
    releaseClaims: releaseClaims as unknown as typeof releaseClaimedRecipients,
    ...overrides,
  });
}

describe("bounded immediate dispatch", () => {
  it("claims only the signal that was just published", async () => {
    runDispatch.mockResolvedValue(summary({ claimed: 2, sent: 2 }));
    const before = Date.now();

    await dispatch();

    expect(runDispatch).toHaveBeenCalledTimes(1);
    const options = runDispatch.mock.calls[0][0] as DispatchOptions;
    expect(options).toEqual(
      expect.objectContaining({
        signalId: SIGNAL_ID,
        batchSize: IMMEDIATE_DISPATCH_BATCH_SIZE,
        timeBudgetMs: IMMEDIATE_DISPATCH_TIME_BUDGET_MS,
        config: CONFIG,
        transport,
      })
    );
    // The dispatcher gets an absolute deadline, so it can refuse to start an
    // attempt that could not finish inside the invocation.
    expect(typeof options.deadlineAt).toBe("number");
    expect(options.deadlineAt).toBeGreaterThanOrEqual(
      before + IMMEDIATE_DISPATCH_DEADLINE_MS
    );
    expect(options.deadlineAt).toBeLessThanOrEqual(
      Date.now() + IMMEDIATE_DISPATCH_DEADLINE_MS
    );
  });

  it("reports the counts the dispatcher recorded", async () => {
    runDispatch.mockResolvedValue(
      summary({ claimed: 4, sent: 2, failed: 1, skipped: 1, terminalFailures: 1 })
    );
    countPending.mockResolvedValue(3);

    await expect(dispatch()).resolves.toEqual({
      attempted: 4,
      sent: 2,
      failed: 1,
      skipped: 1,
      pending: 3,
      status: "DISPATCHED",
    });
    expect(countPending).toHaveBeenCalledWith(SIGNAL_ID);
  });
});

describe("publication survives delivery problems", () => {
  it("leaves recipients queued when SMTP is not configured", async () => {
    resolveConfig.mockReturnValue({
      ok: false,
      problems: ["SIGNALS_SMTP_HOST is missing."],
    });
    countPending.mockResolvedValue(2);

    await expect(dispatch()).resolves.toEqual({
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      pending: 2,
      status: "EMAIL_NOT_CONFIGURED",
    });
    expect(runDispatch).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("never throws and reports unknown counts when the dispatcher fails", async () => {
    runDispatch.mockRejectedValue(new Error("database unavailable"));
    countPending.mockResolvedValue(4);

    await expect(dispatch()).resolves.toEqual({
      attempted: null,
      sent: null,
      failed: null,
      skipped: null,
      pending: 4,
      status: "DISPATCH_FAILED",
    });
  });

  it("does not invent counts when the dispatcher and the queue count both fail", async () => {
    runDispatch.mockRejectedValue(new Error("database unavailable"));
    countPending.mockRejectedValue(new Error("count failed"));

    await expect(dispatch()).resolves.toEqual({
      attempted: null,
      sent: null,
      failed: null,
      skipped: null,
      pending: null,
      status: "DISPATCH_FAILED",
    });
  });

  it("reports unknown counts when configuration resolution throws", async () => {
    resolveConfig.mockImplementation(() => {
      throw new Error("config exploded");
    });
    countPending.mockResolvedValue(2);

    await expect(dispatch()).resolves.toEqual({
      attempted: null,
      sent: null,
      failed: null,
      skipped: null,
      pending: 2,
      status: "DISPATCH_FAILED",
    });
  });
});

describe("reporting failures after delivery", () => {
  it("preserves successful sends when the queue count fails", async () => {
    runDispatch.mockResolvedValue(
      summary({ claimed: 3, sent: 2, failed: 1, terminalFailures: 1 })
    );
    countPending.mockRejectedValue(new Error("count failed"));

    await expect(dispatch()).resolves.toEqual({
      attempted: 3,
      sent: 2,
      failed: 1,
      skipped: 0,
      pending: null,
      status: "DISPATCHED_REPORTING_FAILED",
    });
  });

  it("keeps every delivery count when only reporting failed", async () => {
    runDispatch.mockResolvedValue(
      summary({ claimed: 4, sent: 2, failed: 1, skipped: 1 })
    );
    countPending.mockRejectedValue(new Error("count failed"));

    const result = await dispatch();

    expect(result).toEqual({
      attempted: 4,
      sent: 2,
      failed: 1,
      skipped: 1,
      pending: null,
      status: "DISPATCHED_REPORTING_FAILED",
    });
    expect(result.sent).not.toBe(0);
  });

  it("does not report zero pending when the count fails after zero sends", async () => {
    runDispatch.mockResolvedValue(summary({ claimed: 2, skipped: 2 }));
    countPending.mockRejectedValue(new Error("count failed"));

    await expect(dispatch()).resolves.toEqual({
      attempted: 2,
      sent: 0,
      failed: 0,
      skipped: 2,
      pending: null,
      status: "DISPATCHED_REPORTING_FAILED",
    });
  });

  it("keeps an unconfigured-mailbox result truthful when the count fails", async () => {
    resolveConfig.mockReturnValue({
      ok: false,
      problems: ["SIGNALS_SMTP_HOST is missing."],
    });
    countPending.mockRejectedValue(new Error("count failed"));

    await expect(dispatch()).resolves.toEqual({
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      pending: null,
      status: "EMAIL_NOT_CONFIGURED",
    });
    expect(runDispatch).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe("deferred claims", () => {
  it("returns unattempted recipients to the queue under the claim owner", async () => {
    runDispatch.mockImplementation(async (options: DispatchOptions) => {
      await options.onUnattempted?.([
        {
          recipientId: RECIPIENT_A,
          signalId: SIGNAL_ID,
          userId: "aaaaaaaa-1111-4111-8111-111111111111",
          emailAddress: "customer@example.com",
          priorAttempts: 0,
          message: "hello",
        },
        {
          recipientId: RECIPIENT_B,
          signalId: SIGNAL_ID,
          userId: "bbbbbbbb-2222-4222-8222-222222222222",
          emailAddress: "other@example.com",
          priorAttempts: 0,
          message: "hello",
        },
      ]);
      return summary({ claimed: 2, deferred: 2 });
    });
    countPending.mockResolvedValue(2);

    const result = await dispatch();

    expect(result).toMatchObject({ attempted: 0, sent: 0, pending: 2 });
    const owner = runDispatch.mock.calls[0][0].owner as string;
    expect(owner).toMatch(/^publish-/);
    expect(releaseClaims).toHaveBeenCalledWith([RECIPIENT_A, RECIPIENT_B], owner);
  });
});
