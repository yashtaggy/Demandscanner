/**
 * Phase S4 HTTP surface: customer gate, origin protection, rate limits, body
 * parsing and response envelopes.
 *
 * The customer service is mocked here; its scoping rules have their own suite.
 */

jest.mock("@/lib/auth/session", () => ({
  requireCustomer: jest.fn(),
}));

jest.mock("@/lib/auth/rate-limit", () => ({
  consumeRateLimit: jest.fn(),
}));

jest.mock("@/lib/signals/customer-service", () => ({
  customerInbox: jest.fn(),
  customerSignal: jest.fn(),
  updateCustomerReadState: jest.fn(),
  customerUnreadCount: jest.fn(),
}));

import { NextRequest } from "next/server";
import { requireCustomer } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { AppAuthError } from "@/lib/auth/types";
import * as service from "@/lib/signals/customer-service";
import { SignalsError } from "@/lib/signals/errors";

import { GET as inboxGet } from "@/app/api/signals/route";
import { GET as detailGet } from "@/app/api/signals/[signalId]/route";
import { PATCH as readPatch } from "@/app/api/signals/[signalId]/read/route";
import { GET as unreadGet } from "@/app/api/signals/unread-count/route";

const mockedService = service as jest.Mocked<typeof service>;
const mockedAuth = jest.mocked(requireCustomer);
const mockedLimit = jest.mocked(consumeRateLimit);

const CUSTOMER = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "customer@example.com",
  displayName: "Customer",
  status: "ACTIVE" as const,
  role: "CUSTOMER" as const,
};

const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";

const INBOX = {
  signals: [
    {
      signalId: SIGNAL_ID,
      messagePreview: "hello",
      publishedAt: "2026-11-14T10:00:00.000Z",
      readAt: null,
      isRead: false,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  unreadCount: 1,
};

const DETAIL = {
  signalId: SIGNAL_ID,
  message: "  line 1\nline 2 🔥  ",
  publishedAt: "2026-11-14T10:00:00.000Z",
  readAt: null,
  isRead: false,
};

const READ_STATE = {
  signalId: SIGNAL_ID,
  readAt: "2026-11-14T11:00:00.000Z",
  isRead: true,
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
  mockedAuth.mockResolvedValue(CUSTOMER);
  mockedLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("customer gate", () => {
  const endpoints = [
    {
      name: "inbox",
      call: () => inboxGet(request("/api/signals")),
    },
    {
      name: "unread count",
      call: () => unreadGet(request("/api/signals/unread-count")),
    },
    {
      name: "detail",
      call: () =>
        detailGet(request(`/api/signals/${SIGNAL_ID}`), context()),
    },
    {
      name: "read state",
      call: () =>
        readPatch(
          request(`/api/signals/${SIGNAL_ID}/read`, {
            method: "PATCH",
            body: { isRead: true },
          }),
          context()
        ),
    },
  ];

  it.each(endpoints)("$name requires an authenticated session", async ({ call }) => {
    mockedAuth.mockRejectedValue(new AppAuthError("UNAUTHENTICATED"));
    const res = await call();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it.each(endpoints)("$name rejects admin roles", async ({ call }) => {
    mockedAuth.mockRejectedValue(new AppAuthError("FORBIDDEN"));
    const res = await call();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it.each(endpoints)("$name rejects suspended and disabled accounts", async ({ call }) => {
    mockedAuth.mockRejectedValue(new AppAuthError("SUSPENDED"));
    const suspended = await call();
    expect(suspended.status).toBe(403);

    mockedAuth.mockRejectedValue(new AppAuthError("DISABLED"));
    const disabled = await call();
    expect(disabled.status).toBe(403);
  });
});

describe("mutation origin protection", () => {
  it("rejects a cross-origin read-state change before authenticating", async () => {
    const res = await readPatch(
      request(`/api/signals/${SIGNAL_ID}/read`, {
        method: "PATCH",
        body: { isRead: true },
        origin: "https://evil.test",
      }),
      context()
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedService.updateCustomerReadState).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("returns 429 and skips the service", async () => {
    mockedLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const res = await inboxGet(request("/api/signals"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    await expect(res.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
    expect(mockedService.customerInbox).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the limiter is unavailable", async () => {
    mockedLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });
    const res = await readPatch(
      request(`/api/signals/${SIGNAL_ID}/read`, {
        method: "PATCH",
        body: { isRead: true },
      }),
      context()
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: "RATE_LIMIT_UNAVAILABLE",
    });
    expect(mockedService.updateCustomerReadState).not.toHaveBeenCalled();
  });

  it("limits each customer with a key derived from the session", async () => {
    mockedService.customerInbox.mockResolvedValue(INBOX);
    await inboxGet(request("/api/signals"));
    expect(mockedLimit.mock.calls[0][0]).toContain(CUSTOMER.userId);
  });
});

describe("customer inbox", () => {
  it("returns the page and no-store headers", async () => {
    mockedService.customerInbox.mockResolvedValue(INBOX);
    const res = await inboxGet(request("/api/signals?page=2&pageSize=5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/i);
    const body = await res.json();
    expect(body).toEqual({ ok: true, ...INBOX });
    expect(Object.keys(body).sort()).toEqual(
      ["ok", "page", "pageSize", "signals", "total", "unreadCount"].sort()
    );
    expect(mockedService.customerInbox).toHaveBeenCalledWith(
      CUSTOMER,
      expect.any(URLSearchParams)
    );
  });

  it("never treats a query-string user id as identity", async () => {
    mockedService.customerInbox.mockResolvedValue(INBOX);
    const other = "bbbbbbbb-2222-4222-8222-222222222222";
    await inboxGet(request(`/api/signals?userId=${other}`));
    const [actor] = mockedService.customerInbox.mock.calls[0];
    expect(actor.userId).toBe(CUSTOMER.userId);
    expect(actor.userId).not.toBe(other);
  });

  it("maps invalid pagination to a 400", async () => {
    mockedService.customerInbox.mockRejectedValue(
      new SignalsError(400, "INVALID_PAGINATION", "Page must be a whole number.")
    );
    const res = await inboxGet(request("/api/signals?page=0"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_PAGINATION" });
  });
});

describe("customer signal detail", () => {
  it("returns the full message with no administrative fields", async () => {
    mockedService.customerSignal.mockResolvedValue(DETAIL);
    const res = await detailGet(
      request(`/api/signals/${SIGNAL_ID}`),
      context()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/i);
    const body = await res.json();
    expect(body).toEqual({ ok: true, signal: DETAIL });
    expect(Object.keys(body.signal).sort()).toEqual(
      ["isRead", "message", "publishedAt", "readAt", "signalId"].sort()
    );
    expect(mockedService.customerSignal).toHaveBeenCalledWith(CUSTOMER, SIGNAL_ID);
  });

  it("returns 404 for a signal that is not assigned to this customer", async () => {
    mockedService.customerSignal.mockRejectedValue(
      new SignalsError(404, "SIGNAL_NOT_FOUND", "Signal not found.")
    );
    const res = await detailGet(
      request(`/api/signals/${SIGNAL_ID}`),
      context()
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Signal not found.",
      code: "SIGNAL_NOT_FOUND",
    });
  });

  it("passes a malformed id through to the service, which answers 404", async () => {
    mockedService.customerSignal.mockRejectedValue(
      new SignalsError(404, "SIGNAL_NOT_FOUND", "Signal not found.")
    );
    const res = await detailGet(
      request("/api/signals/not-a-uuid"),
      context("not-a-uuid")
    );
    expect(mockedService.customerSignal).toHaveBeenCalledWith(CUSTOMER, "not-a-uuid");
    expect(res.status).toBe(404);
  });
});

describe("read state", () => {
  it("returns the updated state for a valid body", async () => {
    mockedService.updateCustomerReadState.mockResolvedValue(READ_STATE);
    const res = await readPatch(
      request(`/api/signals/${SIGNAL_ID}/read`, {
        method: "PATCH",
        body: { isRead: true },
      }),
      context()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/i);
    await expect(res.json()).resolves.toEqual({ ok: true, signal: READ_STATE });
    expect(mockedService.updateCustomerReadState).toHaveBeenCalledWith(
      CUSTOMER,
      SIGNAL_ID,
      { isRead: true }
    );
  });

  it("rejects malformed JSON and non-JSON content types before the service", async () => {
    const malformed = await readPatch(
      request(`/api/signals/${SIGNAL_ID}/read`, {
        method: "PATCH",
        rawBody: "{not-json",
      }),
      context()
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ code: "INVALID_BODY" });

    const wrongType = await readPatch(
      request(`/api/signals/${SIGNAL_ID}/read`, {
        method: "PATCH",
        body: { isRead: true },
        contentType: "text/plain",
      }),
      context()
    );
    expect(wrongType.status).toBe(400);
    expect(mockedService.updateCustomerReadState).not.toHaveBeenCalled();
  });

  it("maps an invalid isRead value to a 400", async () => {
    mockedService.updateCustomerReadState.mockRejectedValue(
      new SignalsError(400, "INVALID_READ_STATE", "isRead must be true or false.")
    );
    const res = await readPatch(
      request(`/api/signals/${SIGNAL_ID}/read`, {
        method: "PATCH",
        body: { isRead: "true" },
      }),
      context()
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_READ_STATE" });
  });

  it("returns 404 when the update matched no owned row", async () => {
    mockedService.updateCustomerReadState.mockRejectedValue(
      new SignalsError(404, "SIGNAL_NOT_FOUND", "Signal not found.")
    );
    const res = await readPatch(
      request(`/api/signals/${SIGNAL_ID}/read`, {
        method: "PATCH",
        body: { isRead: false },
      }),
      context()
    );
    expect(res.status).toBe(404);
  });
});

describe("unread count", () => {
  it("returns the session customer's count with no-store", async () => {
    mockedService.customerUnreadCount.mockResolvedValue(3);
    const res = await unreadGet(request("/api/signals/unread-count"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/i);
    await expect(res.json()).resolves.toEqual({ ok: true, unreadCount: 3 });
    expect(mockedService.customerUnreadCount).toHaveBeenCalledWith(CUSTOMER);
  });
});
