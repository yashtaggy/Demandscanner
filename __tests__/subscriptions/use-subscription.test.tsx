/**
 * @jest-environment jsdom
 *
 * `useSubscription` reads the session user's own state. It must not fetch
 * before an app session exists, must treat 401 as "signed out", and must keep
 * the last error visible instead of rendering stale access.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useSubscription, type SubscriptionMe } from "@/hooks/use-subscription";

const mockFetch = jest.fn();

const PAYLOAD: SubscriptionMe = {
  user: {
    userId: "bbbbbbbb-2222-4222-8222-222222222222",
    email: "customer@example.com",
    displayName: "Customer",
    status: "ACTIVE",
    role: "CUSTOMER",
  },
  subscriptionRequired: true,
  entitled: true,
  today: "2026-11-13",
  current: null,
  history: [],
  payments: [],
};

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

describe("useSubscription", () => {
  it("does not request anything before the session exists", () => {
    const { result } = renderHook(() => useSubscription(false));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("loads the authenticated user's state", async () => {
    mockFetch.mockResolvedValue(response(200, PAYLOAD));

    const { result } = renderHook(() => useSubscription(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(PAYLOAD);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith("/api/subscription/me", {
      cache: "no-store",
    });
  });

  it("treats 401 as signed out without showing an error", async () => {
    mockFetch.mockResolvedValue(response(401, { error: "Unauthenticated" }));

    const { result } = renderHook(() => useSubscription(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces the server's safe error message", async () => {
    mockFetch.mockResolvedValue(
      response(500, { error: "The request could not be completed." })
    );

    const { result } = renderHook(() => useSubscription(true));

    await waitFor(() =>
      expect(result.current.error).toBe("The request could not be completed.")
    );
    expect(result.current.data).toBeNull();
  });

  it("refetches on demand", async () => {
    mockFetch
      .mockResolvedValueOnce(response(200, PAYLOAD))
      .mockResolvedValueOnce(response(200, { ...PAYLOAD, entitled: false }));

    const { result } = renderHook(() => useSubscription(true));
    await waitFor(() => expect(result.current.data?.entitled).toBe(true));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data?.entitled).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
