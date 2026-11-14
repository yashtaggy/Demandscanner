/**
 * Signals service rules with the repository mocked.
 *
 * Covers the decisions the service owns: validation before I/O, server-side
 * audience selection, idempotent replay versus key reuse, error mapping and
 * path-id checks.
 */

import type { AppUser } from "@/lib/auth/types";
import { signalRequestFingerprint } from "@/lib/signals/fingerprint";
import * as repo from "@/lib/signals/repository";
import {
  eligibleRecipients,
  publishSignal,
  retryFailedRecipients,
  signalDetail,
  signalHistory,
} from "@/lib/signals/service";
import type { SignalAudience } from "@/lib/signals/validation";

jest.mock("@/lib/signals/repository", () => ({
  findPublicationById: jest.fn(),
  findPublicationByIdempotencyKey: jest.fn(),
  findSignalDetail: jest.fn(),
  listEligibleRecipients: jest.fn(),
  listSignalHistory: jest.fn(),
  publishSignal: jest.fn(),
  retryFailedRecipients: jest.fn(),
}));

const mocked = repo as jest.Mocked<typeof repo>;

const ACTOR: AppUser = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "root@example.com",
  displayName: "Root",
  role: "SUPER_ADMIN",
  status: "ACTIVE",
};

const ID_A = "bbbbbbbb-2222-4222-8222-222222222222";
const ID_B = "cccccccc-3333-4333-8333-333333333333";
const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";

const PUBLICATION = {
  signalId: SIGNAL_ID,
  message: "  exact  ",
  publishedAt: "2026-11-14T10:00:00.000Z",
  createdBy: ACTOR.userId,
  status: "PUBLISHED" as const,
  recipientCount: 2,
};

function recordFor(message: string, audience: SignalAudience) {
  return {
    ...PUBLICATION,
    message,
    idempotencyFingerprint: signalRequestFingerprint(message, audience),
  };
}

const ALL: SignalAudience = { mode: "ALL_ELIGIBLE" };
const SELECTED_A: SignalAudience = { mode: "SELECTED", userIds: [ID_A] };
const SELECTED_AB: SignalAudience = { mode: "SELECTED", userIds: [ID_A, ID_B] };

async function expectSignalsError(
  promise: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, code });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("publishing", () => {
  it("validates before any database work", async () => {
    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "   ",
        audience: { mode: "ALL_ELIGIBLE" },
      }),
      400,
      "MESSAGE_BLANK"
    );
    expect(mocked.publishSignal).not.toHaveBeenCalled();
    expect(mocked.findPublicationByIdempotencyKey).not.toHaveBeenCalled();
  });

  it("passes the message and matching fingerprint to the repository", async () => {
    const message = "  Signal\n\nline 2\t🔥  ";
    const audience: SignalAudience = {
      mode: "SELECTED",
      userIds: [ID_A],
    };
    mocked.publishSignal.mockResolvedValue({
      kind: "created",
      signalId: SIGNAL_ID,
    });
    mocked.findPublicationById.mockResolvedValue(recordFor(message, audience));

    const result = await publishSignal(ACTOR, {
      message,
      audience,
      idempotencyKey: "key-1",
    });

    expect(result).toMatchObject({ message, reused: false });
    expect(mocked.publishSignal).toHaveBeenCalledWith({
      signalId: expect.any(String),
      actorUserId: ACTOR.userId,
      message,
      audience: { mode: "SELECTED", userIds: [ID_A] },
      idempotencyKey: "key-1",
      idempotencyFingerprint: signalRequestFingerprint(message, audience),
    });
  });

  it("returns the original publication for the same logical request", async () => {
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(
      recordFor("hello", ALL)
    );

    const result = await publishSignal(ACTOR, {
      message: "hello",
      audience: { mode: "ALL_ELIGIBLE" },
      idempotencyKey: "key-1",
    });

    expect(result).toEqual({ ...PUBLICATION, message: "hello", reused: true });
    expect(mocked.publishSignal).not.toHaveBeenCalled();
  });

  it("treats a reordered or duplicated recipient list as the same request", async () => {
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(
      recordFor("hello", SELECTED_AB)
    );

    const result = await publishSignal(ACTOR, {
      message: "hello",
      audience: {
        mode: "SELECTED",
        userIds: [ID_B, ID_A, ID_B],
      },
      idempotencyKey: "key-1",
    });

    expect(result).toMatchObject({ signalId: SIGNAL_ID, reused: true });
    expect(mocked.publishSignal).not.toHaveBeenCalled();
  });

  it("rejects the same key with a different message", async () => {
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(
      recordFor("hello", ALL)
    );

    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "goodbye",
        audience: { mode: "ALL_ELIGIBLE" },
        idempotencyKey: "key-1",
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
    expect(mocked.publishSignal).not.toHaveBeenCalled();
  });

  it("rejects the same key with different explicit recipients", async () => {
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(
      recordFor("hello", SELECTED_A)
    );

    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "hello",
        audience: { mode: "SELECTED", userIds: [ID_A, ID_B] },
        idempotencyKey: "key-1",
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  });

  it("rejects the same key with a different audience mode", async () => {
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(
      recordFor("hello", ALL)
    );

    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "hello",
        audience: { mode: "SELECTED", userIds: [ID_A] },
        idempotencyKey: "key-1",
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  });

  it("fails closed for a publication that predates fingerprints", async () => {
    mocked.findPublicationByIdempotencyKey.mockResolvedValue({
      ...PUBLICATION,
      message: "hello",
      idempotencyFingerprint: null,
    });

    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "hello",
        audience: { mode: "ALL_ELIGIBLE" },
        idempotencyKey: "key-1",
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  });

  it("resolves all-eligible audiences on the server without a fingerprint", async () => {
    mocked.publishSignal.mockResolvedValue({
      kind: "created",
      signalId: SIGNAL_ID,
    });
    mocked.findPublicationById.mockResolvedValue({
      ...PUBLICATION,
      message: "hello",
      idempotencyFingerprint: null,
    });

    const result = await publishSignal(ACTOR, {
      message: "hello",
      audience: { mode: "ALL_ELIGIBLE" },
    });

    expect(result).toEqual({ ...PUBLICATION, message: "hello", reused: false });
    expect(mocked.publishSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: { mode: "ALL_ELIGIBLE" },
        idempotencyKey: null,
        idempotencyFingerprint: null,
      })
    );
  });

  it("rejects the whole selection when any requested customer is not an active CUSTOMER", async () => {
    // Covers missing, suspended, disabled, ADMIN and SUPER_ADMIN selections:
    // the database reports the count mismatch and nothing is written.
    mocked.publishSignal.mockResolvedValueOnce({
      kind: "recipient_mismatch",
      requestedCount: 2,
      eligibleCount: 1,
    });
    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "hello",
        audience: { mode: "SELECTED", userIds: [ID_A, ID_B] },
      }),
      409,
      "RECIPIENT_NOT_ELIGIBLE"
    );
    expect(mocked.findPublicationById).not.toHaveBeenCalled();
  });

  it("maps repository outcomes to public conflicts", async () => {
    mocked.publishSignal.mockResolvedValueOnce({ kind: "no_recipients" });
    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "hello",
        audience: { mode: "ALL_ELIGIBLE" },
      }),
      409,
      "NO_ELIGIBLE_RECIPIENTS"
    );

    mocked.publishSignal.mockResolvedValueOnce({
      kind: "too_many_recipients",
      eligibleCount: 1001,
    });
    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "hello",
        audience: { mode: "ALL_ELIGIBLE" },
      }),
      409,
      "TOO_MANY_RECIPIENTS"
    );

    expect(mocked.findPublicationById).not.toHaveBeenCalled();
  });

  it("recovers a concurrent identical conflict by reading the winner", async () => {
    mocked.publishSignal.mockResolvedValue({ kind: "conflict" });
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(
      recordFor("hello", ALL)
    );

    const result = await publishSignal(ACTOR, {
      message: "hello",
      audience: { mode: "ALL_ELIGIBLE" },
      idempotencyKey: "key-1",
    });
    expect(result).toMatchObject({ signalId: SIGNAL_ID, reused: true });
  });

  it("rejects a concurrent conflicting reuse by reading the winner", async () => {
    mocked.publishSignal.mockResolvedValue({ kind: "conflict" });
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(
      recordFor("the winner's message", ALL)
    );

    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "a different message",
        audience: { mode: "ALL_ELIGIBLE" },
        idempotencyKey: "key-1",
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  });

  it("checks the fingerprint when the insert reports an existing signal", async () => {
    mocked.publishSignal.mockResolvedValue({
      kind: "existing",
      signalId: SIGNAL_ID,
    });
    mocked.findPublicationById.mockResolvedValue(
      recordFor("the winner's message", ALL)
    );

    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "a different message",
        audience: { mode: "ALL_ELIGIBLE" },
        idempotencyKey: "key-1",
      }),
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  });

  it("returns a retryable failure when no winner is visible", async () => {
    mocked.publishSignal.mockResolvedValue({ kind: "conflict" });
    mocked.findPublicationByIdempotencyKey.mockResolvedValue(null);

    await expectSignalsError(
      publishSignal(ACTOR, {
        message: "hello",
        audience: { mode: "ALL_ELIGIBLE" },
        idempotencyKey: "key-1",
      }),
      503,
      "PUBLICATION_RETRY"
    );
  });
});

describe("queries", () => {
  it("parses recipient search parameters before querying", async () => {
    mocked.listEligibleRecipients.mockResolvedValue({
      recipients: [],
      hasMore: false,
    });

    await eligibleRecipients(new URLSearchParams("search= ravi &limit=50"));
    expect(mocked.listEligibleRecipients).toHaveBeenCalledWith("ravi", 50);

    mocked.listEligibleRecipients.mockClear();
    await expectSignalsError(
      eligibleRecipients(new URLSearchParams("limit=999")),
      400,
      "INVALID_PAGINATION"
    );
    expect(mocked.listEligibleRecipients).not.toHaveBeenCalled();
  });

  it("parses history pagination before querying", async () => {
    mocked.listSignalHistory.mockResolvedValue({
      signals: [],
      page: 2,
      pageSize: 25,
      total: 0,
    });
    await signalHistory(new URLSearchParams("page=2&pageSize=25"));
    expect(mocked.listSignalHistory).toHaveBeenCalledWith(2, 25);
  });

  it("rejects malformed and missing signal ids", async () => {
    await expectSignalsError(signalDetail("not-a-uuid"), 404, "SIGNAL_NOT_FOUND");
    await expectSignalsError(
      signalDetail(SIGNAL_ID),
      404,
      "SIGNAL_NOT_FOUND"
    );
    expect(mocked.findSignalDetail).toHaveBeenCalledTimes(1);
  });

  it("returns detail for an existing signal", async () => {
    const detail = {
      signalId: SIGNAL_ID,
      message: "hello",
      publishedAt: PUBLICATION.publishedAt,
      createdAt: PUBLICATION.publishedAt,
      status: "PUBLISHED" as const,
      createdBy: null,
      recipientCount: 0,
      delivery: { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 },
      read: { read: 0, unread: 0 },
      recipients: [],
    };
    mocked.findSignalDetail.mockResolvedValue(detail);
    await expect(signalDetail(SIGNAL_ID)).resolves.toEqual(detail);
  });
});

describe("retry", () => {
  it("rejects malformed and missing signals", async () => {
    await expectSignalsError(
      retryFailedRecipients(ACTOR, "not-a-uuid"),
      404,
      "SIGNAL_NOT_FOUND"
    );
    expect(mocked.retryFailedRecipients).not.toHaveBeenCalled();

    mocked.retryFailedRecipients.mockResolvedValue({
      signalFound: false,
      retriedCount: 0,
    });
    await expectSignalsError(
      retryFailedRecipients(ACTOR, SIGNAL_ID),
      404,
      "SIGNAL_NOT_FOUND"
    );
  });

  it("returns the requeued count", async () => {
    mocked.retryFailedRecipients.mockResolvedValue({
      signalFound: true,
      retriedCount: 2,
    });
    await expect(retryFailedRecipients(ACTOR, SIGNAL_ID)).resolves.toEqual({
      signalId: SIGNAL_ID,
      retriedCount: 2,
    });
    expect(mocked.retryFailedRecipients).toHaveBeenCalledWith(ACTOR, SIGNAL_ID);
  });
});
