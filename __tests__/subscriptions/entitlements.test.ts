/**
 * Central entitlement gate behaviour: identity first, subscription second.
 */

import type { AppUser } from "@/lib/auth/types";
import { AppAuthError } from "@/lib/auth/types";
import type { SubscriptionState } from "@/lib/subscriptions/types";

jest.mock("@/lib/auth/session", () => ({
  requireAppUser: jest.fn(),
}));

jest.mock("@/lib/subscriptions/repository", () => ({
  getSubscriptionState: jest.fn(),
}));

import { requireAppUser } from "@/lib/auth/session";
import { getSubscriptionState } from "@/lib/subscriptions/repository";
import {
  getOwnSubscriptionState,
  requireActiveSubscription,
  requireActiveSubscriptionUser,
} from "@/lib/subscriptions/entitlements";

const mockedRequireAppUser = jest.mocked(requireAppUser);
const mockedGetState = jest.mocked(getSubscriptionState);

const USER: AppUser = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "customer@example.com",
  displayName: "Customer",
  role: "CUSTOMER",
  status: "ACTIVE",
};

function state(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    entitled: true,
    today: "2026-11-13",
    current: null,
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAppUser.mockResolvedValue(USER);
  mockedGetState.mockResolvedValue(state());
});

describe("requireActiveSubscription", () => {
  it("returns the user and subscription state when entitled", async () => {
    const expected = state();
    mockedGetState.mockResolvedValue(expected);

    await expect(requireActiveSubscription("ds_app_session=abc")).resolves.toEqual({
      user: USER,
      subscription: expected,
    });

    expect(mockedRequireAppUser).toHaveBeenCalledWith("ds_app_session=abc");
    expect(mockedGetState).toHaveBeenCalledWith(USER.userId);
  });

  it("propagates identity failures without consulting subscriptions", async () => {
    mockedRequireAppUser.mockRejectedValue(new AppAuthError("SUSPENDED"));

    await expect(requireActiveSubscription(null)).rejects.toMatchObject({
      reason: "SUSPENDED",
    });
    expect(mockedGetState).not.toHaveBeenCalled();
  });

  it("throws SUBSCRIPTION_REQUIRED when the database says not entitled", async () => {
    mockedGetState.mockResolvedValue(state({ entitled: false, current: null }));

    await expect(requireActiveSubscription("cookie")).rejects.toMatchObject({
      name: "AppAuthError",
      reason: "SUBSCRIPTION_REQUIRED",
    });
  });

  it("propagates database failures instead of granting access", async () => {
    mockedGetState.mockRejectedValue(new Error("connection reset"));

    await expect(requireActiveSubscription("cookie")).rejects.toThrow("connection reset");
  });
});

describe("requireActiveSubscriptionUser", () => {
  it("returns only the app user", async () => {
    await expect(requireActiveSubscriptionUser("cookie")).resolves.toBe(USER);
  });

  it("still enforces the subscription", async () => {
    mockedGetState.mockResolvedValue(state({ entitled: false }));
    await expect(requireActiveSubscriptionUser("cookie")).rejects.toMatchObject({
      reason: "SUBSCRIPTION_REQUIRED",
    });
  });
});

describe("getOwnSubscriptionState", () => {
  it("reports state instead of throwing when no subscription exists", async () => {
    const expired = state({ entitled: false });
    mockedGetState.mockResolvedValue(expired);

    await expect(getOwnSubscriptionState("cookie")).resolves.toEqual({
      user: USER,
      subscription: expired,
    });
  });

  it("still requires a valid app session", async () => {
    mockedRequireAppUser.mockRejectedValue(new AppAuthError("UNAUTHENTICATED"));
    await expect(getOwnSubscriptionState(null)).rejects.toMatchObject({
      reason: "UNAUTHENTICATED",
    });
  });
});
