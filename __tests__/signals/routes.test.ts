/**
 * Phase S3 HTTP surface: super-admin gate, mutation origin checks, rate limits,
 * body parsing, path-id propagation and response envelopes.
 *
 * The service layer is mocked here; its rules have their own suite.
 */

jest.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: jest.fn(),
}));

jest.mock("@/lib/auth/rate-limit", () => ({
  consumeRateLimit: jest.fn(),
}));

jest.mock("@/lib/signals/service", () => ({
  eligibleRecipients: jest.fn(),
  publishSignal: jest.fn(),
  retryFailedRecipients: jest.fn(),
  signalDetail: jest.fn(),
  signalHistory: jest.fn(),
}));

import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { AppAuthError } from "@/lib/auth/types";
import * as service from "@/lib/signals/service";
import { SignalsError } from "@/lib/signals/errors";

import { GET as eligibleGet } from "@/app/api/admin/signals/eligible-recipients/route";
import { GET as historyGet, POST as publishPost } from "@/app/api/admin/signals/route";
import { GET as detailGet } from "@/app/api/admin/signals/[signalId]/route";
import { POST as retryPost } from "@/app/api/admin/signals/[signalId]/retry/route";

const mockedService = service as jest.Mocked<typeof service>;
const mockedAuth = jest.mocked(requireSuperAdmin);
const mockedLimit = jest.mocked(consumeRateLimit);

const SUPER_ADMIN = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "root@example.com",
  displayName: "Root",
  status: "ACTIVE" as const,
  role: "SUPER_ADMIN" as const,
};

const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";

const PUBLICATION = {
  signalId: SIGNAL_ID,
  message: "  hello  ",
  publishedAt: "2026-11-14T10:00:00.000Z",
  createdBy: SUPER_ADMIN.userId,
  status: "PUBLISHED" as const,
  recipientCount: 2,
  reused: false,
};

function request(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    origin?: string | null;
    contentType?: string;
  } = {}
): NextRequest {
  const method = init.method ?? "GET";
  const headers = new Headers();
  headers.set("cookie", "ds_app_session=session-cookie");
  if (init.origin !== null) {
    headers.set("origin", init.origin ?? "https://app.test");
  }
  if (method !== "GET" && method !== "HEAD") {
    headers.set("content-type", init.contentType ?? "application/json");
  }
  const body =
    init.rawBody !== undefined
      ? init.rawBody
      : init.body !== undefined
        ? JSON.stringify(init.body)
        : undefined;
  return new NextRequest(new URL(path, "https://app.test"), {
    method,
    headers,
    body,
  });
}

const context = (signalId = SIGNAL_ID) => ({
  params: Promise.resolve({ signalId }),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockedAuth.mockResolvedValue(SUPER_ADMIN);
  mockedLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("super-admin gate", () => {
  const endpoints = [
    {
      name: "eligible recipients",
      call: () => eligibleGet(request("/api/admin/signals/eligible-recipients")),
    },
    {
      name: "history",
      call: () => historyGet(request("/api/admin/signals")),
    },
    {
      name: "detail",
      call: () =>
        detailGet(request(`/api/admin/signals/${SIGNAL_ID}`), context()),
    },
    {
      name: "retry",
      call: () =>
        retryPost(
          request(`/api/admin/signals/${SIGNAL_ID}/retry`, { method: "POST" }),
          context()
        ),
    },
    {
      name: "publish",
      call: () =>
        publishPost(
          request("/api/admin/signals", {
            method: "POST",
            body: { message: "hello", audience: { mode: "ALL_ELIGIBLE" } },
          })
        ),
    },
  ];

  it.each(endpoints)("$name requires an authenticated session", async ({ call }) => {
    mockedAuth.mockRejectedValue(new AppAuthError("UNAUTHENTICATED"));
    const res = await call();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it.each(endpoints)("$name rejects non-super-admin roles", async ({ call }) => {
    mockedAuth.mockRejectedValue(new AppAuthError("FORBIDDEN"));
    const res = await call();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "ACCESS_DENIED" });
  });
});

describe("mutation origin protection", () => {
  it("rejects a cross-origin publication before authenticating", async () => {
    const res = await publishPost(
      request("/api/admin/signals", {
        method: "POST",
        body: { message: "hello", audience: { mode: "ALL_ELIGIBLE" } },
        origin: "https://evil.test",
      })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedService.publishSignal).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin retry before authenticating", async () => {
    const res = await retryPost(
      request(`/api/admin/signals/${SIGNAL_ID}/retry`, {
        method: "POST",
        origin: "https://evil.test",
      }),
      context()
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedService.retryFailedRecipients).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("returns 429 and skips the service", async () => {
    mockedLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const res = await publishPost(
      request("/api/admin/signals", {
        method: "POST",
        body: { message: "hello", audience: { mode: "ALL_ELIGIBLE" } },
      })
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(mockedService.publishSignal).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the limiter is unavailable", async () => {
    mockedLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });
    const res = await historyGet(request("/api/admin/signals"));
    expect(res.status).toBe(503);
    expect(mockedService.signalHistory).not.toHaveBeenCalled();
  });
});

describe("publication endpoint", () => {
  const body = {
    message: "hello",
    audience: { mode: "SELECTED", userIds: [SUPER_ADMIN.userId] },
    idempotencyKey: "key-1",
  };

  it("returns 201 for a new publication", async () => {
    mockedService.publishSignal.mockResolvedValue(PUBLICATION);
    const res = await publishPost(
      request("/api/admin/signals", { method: "POST", body })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toMatch(/no-store/i);
    await expect(res.json()).resolves.toEqual({ ok: true, signal: PUBLICATION });
    expect(mockedService.publishSignal).toHaveBeenCalledWith(SUPER_ADMIN, body);
  });

  it("returns 200 when an idempotency key replays a publication", async () => {
    mockedService.publishSignal.mockResolvedValue({
      ...PUBLICATION,
      reused: true,
    });
    const res = await publishPost(
      request("/api/admin/signals", { method: "POST", body })
    );
    expect(res.status).toBe(200);
  });

  it("maps domain conflicts", async () => {
    mockedService.publishSignal.mockRejectedValue(
      new SignalsError(409, "RECIPIENT_NOT_ELIGIBLE", "Not eligible.")
    );
    const res = await publishPost(
      request("/api/admin/signals", { method: "POST", body })
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: "RECIPIENT_NOT_ELIGIBLE",
    });
  });

  it("rejects malformed JSON and non-object bodies", async () => {
    const invalid = await publishPost(
      request("/api/admin/signals", { method: "POST", rawBody: "{not-json" })
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "INVALID_BODY" });

    const array = await publishPost(
      request("/api/admin/signals", { method: "POST", body: [1, 2] })
    );
    expect(array.status).toBe(400);
  });

  it("requires JSON content type", async () => {
    const res = await publishPost(
      request("/api/admin/signals", {
        method: "POST",
        body,
        contentType: "text/plain",
      })
    );
    expect(res.status).toBe(400);
    expect(mockedService.publishSignal).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected failures", async () => {
    mockedService.publishSignal.mockRejectedValue(
      new Error("relation signals does not exist")
    );
    const res = await publishPost(
      request("/api/admin/signals", { method: "POST", body })
    );
    expect(res.status).toBe(500);
    const payload = await res.json();
    expect(payload.code).toBe("SIGNAL_FAILED");
    expect(JSON.stringify(payload)).not.toContain("relation signals");
  });
});

describe("read endpoints", () => {
  it("GET eligible recipients returns only the picker payload", async () => {
    mockedService.eligibleRecipients.mockResolvedValue({
      recipients: [
        {
          userId: "bbbbbbbb-2222-4222-8222-222222222222",
          email: "a@example.com",
          displayName: "A",
        },
      ],
      hasMore: false,
    });

    const res = await eligibleGet(
      request("/api/admin/signals/eligible-recipients?search=ravi&limit=25")
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toMatchObject({ ok: true, hasMore: false });
    expect(payload.recipients).toEqual([
      {
        userId: "bbbbbbbb-2222-4222-8222-222222222222",
        email: "a@example.com",
        displayName: "A",
      },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/password|token|credential/i);

    const params = mockedService.eligibleRecipients.mock.calls[0][0];
    expect(params.get("search")).toBe("ravi");
    expect(params.get("limit")).toBe("25");
  });

  it("GET history forwards pagination and returns summaries", async () => {
    mockedService.signalHistory.mockResolvedValue({
      signals: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });
    const res = await historyGet(
      request("/api/admin/signals?page=2&pageSize=10")
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      signals: [],
      page: 2,
      pageSize: 10,
      total: 0,
    });
    const params = mockedService.signalHistory.mock.calls[0][0];
    expect(params.get("page")).toBe("2");
  });

  it("GET detail forwards the path id", async () => {
    mockedService.signalDetail.mockResolvedValue({ signalId: SIGNAL_ID } as never);
    const res = await detailGet(
      request(`/api/admin/signals/${SIGNAL_ID}`),
      context()
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      signal: { signalId: SIGNAL_ID },
    });
    expect(mockedService.signalDetail).toHaveBeenCalledWith(SIGNAL_ID);
  });
});

describe("retry endpoint", () => {
  it("passes the session actor and path id, and returns the count", async () => {
    mockedService.retryFailedRecipients.mockResolvedValue({
      signalId: SIGNAL_ID,
      retriedCount: 2,
    });
    const res = await retryPost(
      request(`/api/admin/signals/${SIGNAL_ID}/retry`, { method: "POST" }),
      context()
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      retry: { signalId: SIGNAL_ID, retriedCount: 2 },
    });
    expect(mockedService.retryFailedRecipients).toHaveBeenCalledWith(
      SUPER_ADMIN,
      SIGNAL_ID
    );
  });

  it("maps a missing signal to 404", async () => {
    mockedService.retryFailedRecipients.mockRejectedValue(
      new SignalsError(404, "SIGNAL_NOT_FOUND", "Signal not found.")
    );
    const res = await retryPost(
      request(`/api/admin/signals/${SIGNAL_ID}/retry`, { method: "POST" }),
      context()
    );
    expect(res.status).toBe(404);
  });
});
