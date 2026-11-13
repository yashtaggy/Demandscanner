/**
 * Phase 4 HTTP surface: authorization, origin checks, rate limits, action
 * dispatch and response envelopes for the admin subscription API and the
 * customer's own status endpoint.
 *
 * The service layer is mocked here; its rules have their own suite.
 */

jest.mock("@/lib/auth/firebase-admin", () => ({
  verifyFirebaseIdToken: jest.fn(),
  createAppSessionCookie: jest.fn(),
  revokeFirebaseSessions: jest.fn(),
}));

jest.mock("@/lib/auth/session", () => ({
  requireAdmin: jest.fn(),
}));

jest.mock("@/lib/auth/rate-limit", () => ({
  consumeRateLimit: jest.fn(),
}));

jest.mock("@/lib/auth/provisioning", () => {
  const actual = jest.requireActual("@/lib/auth/provisioning");
  return { ...actual, provisionCustomer: jest.fn() };
});

jest.mock("@/lib/subscriptions/entitlements", () => ({
  getOwnSubscriptionState: jest.fn(),
}));

jest.mock("@/lib/subscriptions/repository", () => ({
  listPaymentsForUser: jest.fn(),
}));

jest.mock("@/lib/subscriptions/service", () => ({
  activateSubscription: jest.fn(),
  assignSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  createPlan: jest.fn(),
  extendSubscription: jest.fn(),
  getCustomer: jest.fn(),
  listCustomers: jest.fn(),
  listPlanCatalog: jest.fn(),
  recordPayment: jest.fn(),
  renewSubscription: jest.fn(),
  updatePlan: jest.fn(),
}));

import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { AppAuthError } from "@/lib/auth/types";
import { authErrorResponse } from "@/lib/auth/http";
import { getOwnSubscriptionState } from "@/lib/subscriptions/entitlements";
import { listPaymentsForUser } from "@/lib/subscriptions/repository";
import * as service from "@/lib/subscriptions/service";
import { SubscriptionError } from "@/lib/subscriptions/errors";

import {
  GET as plansGet,
  POST as plansPost,
} from "@/app/api/admin/subscription-plans/route";
import { PATCH as planPatch } from "@/app/api/admin/subscription-plans/[planId]/route";
import { GET as customersGet } from "@/app/api/admin/customers/route";
import { GET as customerGet } from "@/app/api/admin/customers/[userId]/route";
import { POST as assignPost } from "@/app/api/admin/customers/[userId]/subscriptions/route";
import { PATCH as subscriptionPatch } from "@/app/api/admin/customers/[userId]/subscriptions/[subscriptionId]/route";
import { POST as paymentPost } from "@/app/api/admin/customers/[userId]/payments/route";
import { GET as meGet } from "@/app/api/subscription/me/route";

const mocked = service as jest.Mocked<typeof service>;
const mockedRequireAdmin = jest.mocked(requireAdmin);
const mockedLimit = jest.mocked(consumeRateLimit);
const mockedOwnState = jest.mocked(getOwnSubscriptionState);
const mockedPayments = jest.mocked(listPaymentsForUser);

const ADMIN = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "admin@example.com",
  displayName: "Admin",
  status: "ACTIVE" as const,
  role: "ADMIN" as const,
};

const CUSTOMER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const OTHER_ID = "cccccccc-3333-4333-8333-333333333333";
const PLAN_ID = "dddddddd-4444-4444-8444-444444444444";
const SUB_ID = "eeeeeeee-5555-4555-8555-555555555555";

function request(
  path: string,
  init: { method?: string; body?: unknown; origin?: string } = {}
) {
  const headers = new Headers();
  headers.set("cookie", "ds_app_session=session-cookie");
  headers.set("origin", init.origin ?? "https://app.test");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, "https://app.test"), {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const context = <T extends Record<string, string>>(params: T) => ({
  params: Promise.resolve(params),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mockedRequireAdmin.mockResolvedValue(ADMIN);
});

describe("auth error mapping", () => {
  it("returns 403 SUBSCRIPTION_REQUIRED for a healthy account without a plan", async () => {
    const res = authErrorResponse(new AppAuthError("SUBSCRIPTION_REQUIRED"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: "SUBSCRIPTION_REQUIRED",
    });
  });
});

describe("subscription plans", () => {
  it("GET requires an administrator", async () => {
    mockedRequireAdmin.mockRejectedValue(new AppAuthError("UNAUTHENTICATED"));
    const res = await plansGet(request("/api/admin/subscription-plans", { method: "GET" }));
    expect(res.status).toBe(401);
  });

  it("GET returns the plan catalog with no-store caching", async () => {
    mocked.listPlanCatalog.mockResolvedValue([]);
    const res = await plansGet(request("/api/admin/subscription-plans", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/i);
    await expect(res.json()).resolves.toEqual({ ok: true, plans: [] });
  });

  it("POST rejects a cross-origin request before authenticating", async () => {
    const res = await plansPost(
      request("/api/admin/subscription-plans", {
        body: { name: "Monthly" },
        origin: "https://evil.test",
      })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(mockedRequireAdmin).not.toHaveBeenCalled();
  });

  it("POST requires an administrator and a JSON object body", async () => {
    mockedRequireAdmin.mockRejectedValue(new AppAuthError("FORBIDDEN"));
    expect((await plansPost(request("/api/admin/subscription-plans", { body: {} }))).status).toBe(403);

    mockedRequireAdmin.mockResolvedValue(ADMIN);
    const missing = await plansPost(request("/api/admin/subscription-plans", { body: [] }));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ code: "INVALID_BODY" });
  });

  it("POST creates a plan with 201 and maps domain errors", async () => {
    mocked.createPlan.mockResolvedValue({ planId: PLAN_ID } as never);
    const ok = await plansPost(
      request("/api/admin/subscription-plans", {
        body: { name: "Monthly", durationDays: 30, price: 499, currency: "INR", status: "ACTIVE" },
      })
    );
    expect(ok.status).toBe(201);
    expect(mocked.createPlan).toHaveBeenCalledWith(ADMIN, {
      name: "Monthly",
      durationDays: 30,
      price: 499,
      currency: "INR",
      status: "ACTIVE",
    });

    mocked.createPlan.mockRejectedValue(
      new SubscriptionError(409, "PLAN_NAME_EXISTS", "Duplicate.")
    );
    const conflict = await plansPost(
      request("/api/admin/subscription-plans", { body: { name: "Monthly" } })
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: "PLAN_NAME_EXISTS" });
  });

  it("POST rate limits plan changes", async () => {
    mockedLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const res = await plansPost(
      request("/api/admin/subscription-plans", { body: { name: "Monthly" } })
    );
    expect(res.status).toBe(429);
    expect(mocked.createPlan).not.toHaveBeenCalled();
  });

  it("PATCH updates the plan named in the path", async () => {
    mocked.updatePlan.mockResolvedValue({ planId: PLAN_ID } as never);
    const res = await planPatch(
      request(`/api/admin/subscription-plans/${PLAN_ID}`, {
        method: "PATCH",
        body: { status: "INACTIVE" },
      }),
      context({ planId: PLAN_ID })
    );
    expect(res.status).toBe(200);
    expect(mocked.updatePlan).toHaveBeenCalledWith(ADMIN, PLAN_ID, { status: "INACTIVE" });
  });
});

describe("admin customer subscriptions", () => {
  it("GET /api/admin/customers forwards the search term", async () => {
    mocked.listCustomers.mockResolvedValue([]);
    const res = await customersGet(
      request("/api/admin/customers?search=%20ravi%20", { method: "GET" })
    );
    expect(res.status).toBe(200);
    expect(mocked.listCustomers).toHaveBeenCalledWith(" ravi ");
  });

  it("GET /api/admin/customers/:id returns the detail", async () => {
    mocked.getCustomer.mockResolvedValue({ customer: { userId: CUSTOMER_ID } } as never);
    const res = await customerGet(
      request(`/api/admin/customers/${CUSTOMER_ID}`, { method: "GET" }),
      context({ userId: CUSTOMER_ID })
    );
    expect(res.status).toBe(200);
    expect(mocked.getCustomer).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("assigning always uses the path customer id, never the body", async () => {
    mocked.assignSubscription.mockResolvedValue({ subscriptionId: SUB_ID } as never);
    const res = await assignPost(
      request(`/api/admin/customers/${CUSTOMER_ID}/subscriptions`, {
        body: { userId: OTHER_ID, planId: PLAN_ID, startDate: "2026-12-01" },
      }),
      context({ userId: CUSTOMER_ID })
    );
    expect(res.status).toBe(201);
    expect(mocked.assignSubscription).toHaveBeenCalledWith(ADMIN, {
      userId: CUSTOMER_ID,
      planId: PLAN_ID,
      startDate: "2026-12-01",
    });
  });

  it("rejects cross-origin lifecycle changes", async () => {
    const res = await subscriptionPatch(
      request(`/api/admin/customers/${CUSTOMER_ID}/subscriptions/${SUB_ID}`, {
        body: { action: "ACTIVATE" },
        origin: "https://evil.test",
      }),
      context({ userId: CUSTOMER_ID, subscriptionId: SUB_ID })
    );
    expect(res.status).toBe(403);
    expect(mocked.activateSubscription).not.toHaveBeenCalled();
  });

  it("dispatches ACTIVATE, EXTEND, CANCEL and RENEW with the path customer id", async () => {
    mocked.activateSubscription.mockResolvedValue({ subscriptionId: SUB_ID } as never);
    mocked.extendSubscription.mockResolvedValue({ subscriptionId: SUB_ID } as never);
    mocked.cancelSubscription.mockResolvedValue({ subscriptionId: SUB_ID } as never);
    mocked.renewSubscription.mockResolvedValue({ subscriptionId: SUB_ID } as never);

    const call = (body: Record<string, unknown>) =>
      subscriptionPatch(
        request(`/api/admin/customers/${CUSTOMER_ID}/subscriptions/${SUB_ID}`, {
          body,
        }),
        context({ userId: CUSTOMER_ID, subscriptionId: SUB_ID })
      );

    expect((await call({ action: "ACTIVATE" })).status).toBe(200);
    expect(mocked.activateSubscription).toHaveBeenCalledWith(ADMIN, SUB_ID, CUSTOMER_ID);

    expect((await call({ action: "EXTEND", additionalDays: 30 })).status).toBe(200);
    expect(mocked.extendSubscription).toHaveBeenCalledWith(ADMIN, SUB_ID, 30, CUSTOMER_ID);

    expect((await call({ action: "CANCEL", reason: "Customer request" })).status).toBe(200);
    expect(mocked.cancelSubscription).toHaveBeenCalledWith(
      ADMIN,
      SUB_ID,
      "Customer request",
      CUSTOMER_ID
    );

    expect(
      (await call({ action: "RENEW", startDate: "2026-12-01", userId: OTHER_ID })).status
    ).toBe(201);
    expect(mocked.renewSubscription).toHaveBeenCalledWith(ADMIN, {
      action: "RENEW",
      startDate: "2026-12-01",
      userId: OTHER_ID,
      subscriptionId: SUB_ID,
      expectedUserId: CUSTOMER_ID,
    });
  });

  it("rejects unknown actions", async () => {
    const res = await subscriptionPatch(
      request(`/api/admin/customers/${CUSTOMER_ID}/subscriptions/${SUB_ID}`, {
        body: { action: "DELETE" },
      }),
      context({ userId: CUSTOMER_ID, subscriptionId: SUB_ID })
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_ACTION" });
  });

  it("reports ownership mismatches as a 404 from the service", async () => {
    mocked.activateSubscription.mockRejectedValue(
      new SubscriptionError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.")
    );
    const res = await subscriptionPatch(
      request(`/api/admin/customers/${CUSTOMER_ID}/subscriptions/${SUB_ID}`, {
        body: { action: "ACTIVATE" },
      }),
      context({ userId: CUSTOMER_ID, subscriptionId: SUB_ID })
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: "SUBSCRIPTION_NOT_FOUND" });
  });

  it("recording a payment uses the path customer id and returns 201", async () => {
    mocked.recordPayment.mockResolvedValue({ paymentId: "pay" } as never);
    const res = await paymentPost(
      request(`/api/admin/customers/${CUSTOMER_ID}/payments`, {
        body: {
          userId: OTHER_ID,
          subscriptionId: SUB_ID,
          amount: 499,
          currency: "INR",
          paymentMethod: "UPI",
        },
      }),
      context({ userId: CUSTOMER_ID })
    );
    expect(res.status).toBe(201);
    expect(mocked.recordPayment).toHaveBeenCalledWith(ADMIN, {
      userId: CUSTOMER_ID,
      subscriptionId: SUB_ID,
      amount: 499,
      currency: "INR",
      paymentMethod: "UPI",
    });
  });
});

describe("GET /api/subscription/me", () => {
  const CUSTOMER = { ...ADMIN, role: "CUSTOMER" as const };
  const STATE = {
    entitled: true,
    today: "2026-11-13",
    current: { subscriptionId: SUB_ID },
    history: [],
  };

  it("returns 401 without a session", async () => {
    mockedOwnState.mockRejectedValue(new AppAuthError("UNAUTHENTICATED"));
    const res = await meGet(request("/api/subscription/me", { method: "GET" }));
    expect(res.status).toBe(401);
  });

  it("scopes everything to the session user and excludes internal payment fields", async () => {
    mockedOwnState.mockResolvedValue({ user: CUSTOMER, subscription: STATE } as never);
    mockedPayments.mockResolvedValue([
      {
        paymentId: "pay-1",
        userId: CUSTOMER.userId,
        subscriptionId: SUB_ID,
        amount: "499.00",
        currency: "INR",
        paymentMethod: "UPI",
        paymentReference: "UTR123",
        paymentDate: "2026-11-13",
        paymentStatus: "RECORDED",
        notes: "internal note",
        recordedBy: ADMIN.userId,
        createdAt: "2026-11-13T00:00:00.000Z",
      },
    ]);

    const res = await meGet(
      request(`/api/subscription/me?userId=${OTHER_ID}`, { method: "GET" })
    );
    expect(res.status).toBe(200);
    expect(mockedPayments).toHaveBeenCalledWith(CUSTOMER.userId);

    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      subscriptionRequired: true,
      entitled: true,
      today: "2026-11-13",
    });
    expect(body.payments).toEqual([
      {
        paymentId: "pay-1",
        amount: "499.00",
        currency: "INR",
        paymentMethod: "UPI",
        paymentReference: "UTR123",
        paymentDate: "2026-11-13",
        paymentStatus: "RECORDED",
      },
    ]);
  });

  it("reports an unentitled account with 200 so the UI can explain it", async () => {
    mockedOwnState.mockResolvedValue({
      user: CUSTOMER,
      subscription: { ...STATE, entitled: false, current: null },
    } as never);
    mockedPayments.mockResolvedValue([]);

    const res = await meGet(request("/api/subscription/me", { method: "GET" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      entitled: false,
      current: null,
      payments: [],
    });
  });

  it("does not mark administrators as subscription-required", async () => {
    mockedOwnState.mockResolvedValue({ user: ADMIN, subscription: STATE } as never);
    mockedPayments.mockResolvedValue([]);
    const res = await meGet(request("/api/subscription/me", { method: "GET" }));
    await expect(res.json()).resolves.toMatchObject({ subscriptionRequired: false });
  });
});
