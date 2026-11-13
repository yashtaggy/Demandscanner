/**
 * Live Trade owner resolution tests.
 *
 * The centralized entitlement gate is mocked; this verifies that ownership
 * comes only from the internal DemandScan user, never from Kite or the request
 * body, and that an unentitled account is refused before any repository call.
 */

jest.mock("@/lib/subscriptions/entitlements", () => ({
  requireActiveSubscription: jest.fn(),
}));

import { requireActiveSubscription } from "@/lib/subscriptions/entitlements";
import { AppAuthError } from "@/lib/auth/types";
import {
  resolveLiveTradeOwner,
  resolveLiveTradeOwnerId,
} from "@/lib/live-trade/ownership";
import { LiveTradeError } from "@/lib/live-trade/errors";
import type { SubscriptionState } from "@/lib/subscriptions/types";

const OWNER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const mockRequireActiveSubscription = requireActiveSubscription as jest.MockedFunction<
  typeof requireActiveSubscription
>;

function appUser(userId: string = OWNER_ID) {
  return {
    userId,
    email: "customer@example.test",
    displayName: "Customer",
    status: "ACTIVE" as const,
    role: "CUSTOMER" as const,
  };
}

function subscriptionState(): SubscriptionState {
  return {
    entitled: true,
    today: "2026-11-13",
    current: null,
    history: [],
  };
}

beforeEach(() => {
  mockRequireActiveSubscription.mockReset();
});

describe("resolveLiveTradeOwner", () => {
  it("returns the internal app user id as the owner", async () => {
    mockRequireActiveSubscription.mockResolvedValue({
      user: appUser(),
      subscription: subscriptionState(),
    });

    const context = await resolveLiveTradeOwner("ds_app_session=abc");

    expect(mockRequireActiveSubscription).toHaveBeenCalledWith(
      "ds_app_session=abc"
    );
    expect(context.ownerId).toBe(OWNER_ID);
    expect(context).not.toHaveProperty("session");
  });

  it("throws UNAUTHENTICATED when no app session is present", async () => {
    mockRequireActiveSubscription.mockRejectedValue(
      new AppAuthError("UNAUTHENTICATED")
    );

    await expect(resolveLiveTradeOwner(null)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });

  it("throws UNAUTHENTICATED for an invalid or unknown identity", async () => {
    mockRequireActiveSubscription.mockRejectedValue(
      new AppAuthError("NO_IDENTITY")
    );

    await expect(
      resolveLiveTradeOwner("ds_app_session=abc")
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("throws FORBIDDEN for a suspended account", async () => {
    mockRequireActiveSubscription.mockRejectedValue(
      new AppAuthError("SUSPENDED")
    );

    await expect(
      resolveLiveTradeOwner("ds_app_session=abc")
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("throws FORBIDDEN for a disabled account", async () => {
    mockRequireActiveSubscription.mockRejectedValue(
      new AppAuthError("DISABLED")
    );

    await expect(
      resolveLiveTradeOwner("ds_app_session=abc")
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("throws SUBSCRIPTION_REQUIRED when the account has no current plan", async () => {
    mockRequireActiveSubscription.mockRejectedValue(
      new AppAuthError("SUBSCRIPTION_REQUIRED")
    );

    await expect(
      resolveLiveTradeOwner("ds_app_session=abc")
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_REQUIRED", status: 403 });
  });

  it("refuses a non-UUID internal user id instead of using it", async () => {
    mockRequireActiveSubscription.mockResolvedValue({
      user: appUser("ZP0001"),
      subscription: subscriptionState(),
    });

    await expect(
      resolveLiveTradeOwner("ds_app_session=abc")
    ).rejects.toMatchObject({ code: "INTERNAL", status: 500 });
  });

  it("does not misreport an unexpected failure as a 401", async () => {
    mockRequireActiveSubscription.mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(
      resolveLiveTradeOwner("ds_app_session=abc")
    ).rejects.toMatchObject({ code: "INTERNAL", status: 500 });
  });

  it("does not leak the owner id in the public error body", async () => {
    mockRequireActiveSubscription.mockRejectedValue(
      new AppAuthError("UNAUTHENTICATED")
    );
    try {
      await resolveLiveTradeOwner(null);
      throw new Error("expected rejection");
    } catch (error) {
      const body = (error as LiveTradeError).toBody();
      expect(body).toEqual({
        error: "Sign in to DemandScan to use Live Trade.",
        code: "UNAUTHENTICATED",
      });
    }
  });
});

describe("resolveLiveTradeOwnerId", () => {
  it("returns only the owner id", async () => {
    mockRequireActiveSubscription.mockResolvedValue({
      user: appUser(),
      subscription: subscriptionState(),
    });
    await expect(resolveLiveTradeOwnerId("ds_app_session=abc")).resolves.toBe(
      OWNER_ID
    );
  });
});
