/**
 * @jest-environment jsdom
 *
 * Live Trade page gate:
 *  - a signed-out user gets a DemandScan sign-in prompt, not the workspace;
 *  - a signed-in user gets the workspace, even before Kite is connected.
 */

const mockAppAuthHook = jest.fn();
const mockBrokerHook = jest.fn();
const mockSubscriptionHook = jest.fn();

jest.mock("@/hooks/use-app-auth", () => ({
  useAppAuth: () => mockAppAuthHook(),
}));

jest.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockBrokerHook(),
}));

jest.mock("@/hooks/use-subscription", () => ({
  useSubscription: () => mockSubscriptionHook(),
}));

jest.mock("@/components/header", () => ({ Header: () => null }));
jest.mock("@/components/live-trade/workspace", () => ({
  LiveTradeWorkspace: ({
    brokerConnected,
  }: {
    brokerConnected: boolean | null;
  }) => (
    <div>
      Live Trade workspace loaded ({String(brokerConnected)})
    </div>
  ),
}));

import { render, screen } from "@testing-library/react";
import LiveTradePage from "@/app/live-trade/page";

function appAuthState(user: boolean) {
  return {
    user: user
      ? {
          userId: "0f8fad5b-d9cb-469f-a165-70867728950e",
          email: "customer@example.test",
          displayName: null,
          status: "ACTIVE" as const,
          role: "CUSTOMER" as const,
        }
      : null,
    loading: false,
    error: null,
    refetch: jest.fn(),
    logout: jest.fn(),
  };
}

function brokerState(authenticated: boolean) {
  return {
    status: authenticated
      ? {
          authenticated: true,
          market: { isOpen: true, exchange: "NSE", nextEvent: "" },
        }
      : { authenticated: false },
    loading: false,
    error: null,
    refetch: jest.fn(),
  };
}

function subscriptionState(
  overrides: {
    loading?: boolean;
    entitled?: boolean;
    current?: unknown;
  } = {}
) {
  return {
    data: {
      ok: true,
      subscriptionRequired: true,
      entitled: overrides.entitled ?? true,
      today: "2026-11-13",
      current: overrides.current ?? {
        subscriptionId: "6a1d0f8e-2b47-4c8e-9a51-3f9c2d7b4e10",
        planName: "Monthly",
        endDate: "2026-12-31",
        effectiveStatus: "ACTIVE",
      },
      history: [],
      payments: [],
    },
    loading: overrides.loading ?? false,
    error: null,
    refetch: jest.fn(),
  };
}

describe("LiveTradePage", () => {
  beforeEach(() => {
    mockSubscriptionHook.mockReturnValue(subscriptionState());
  });

  test("asks a signed-out user to sign in to DemandScan", () => {
    mockAppAuthHook.mockReturnValue(appAuthState(false));
    mockBrokerHook.mockReturnValue(brokerState(false));
    render(<LiveTradePage />);

    expect(screen.getByText("Sign in to use Live Trade")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText(/Live Trade workspace loaded/)).toBeNull();
  });

  test("renders the workspace for a signed-in user without Kite", () => {
    mockAppAuthHook.mockReturnValue(appAuthState(true));
    mockBrokerHook.mockReturnValue(brokerState(false));
    render(<LiveTradePage />);

    expect(
      screen.getByText("Live Trade workspace loaded (false)")
    ).toBeTruthy();
    expect(screen.queryByText("Sign in to use Live Trade")).toBeNull();
  });

  test("reports broker connectivity separately from app sign-in", () => {
    mockAppAuthHook.mockReturnValue(appAuthState(true));
    mockBrokerHook.mockReturnValue(brokerState(true));
    render(<LiveTradePage />);

    expect(
      screen.getByText("Live Trade workspace loaded (true)")
    ).toBeTruthy();
  });

  test("blocks the workspace when the subscription has expired", () => {
    mockAppAuthHook.mockReturnValue(appAuthState(true));
    mockBrokerHook.mockReturnValue(brokerState(true));
    mockSubscriptionHook.mockReturnValue(
      subscriptionState({
        entitled: false,
        current: {
          subscriptionId: "6a1d0f8e-2b47-4c8e-9a51-3f9c2d7b4e10",
          planName: "Monthly",
          startDate: "2026-11-01",
          endDate: "2026-12-31",
          effectiveStatus: "EXPIRED",
        },
      })
    );
    render(<LiveTradePage />);

    expect(screen.getByText("Subscription inactive")).toBeTruthy();
    expect(
      screen.getByText(/Your subscription ended on 2026-12-31/)
    ).toBeTruthy();
    expect(screen.queryByText(/Live Trade workspace loaded/)).toBeNull();
  });

  test("waits for the subscription check before rendering the workspace", () => {
    mockAppAuthHook.mockReturnValue(appAuthState(true));
    mockBrokerHook.mockReturnValue(brokerState(true));
    mockSubscriptionHook.mockReturnValue(subscriptionState({ loading: true }));
    render(<LiveTradePage />);

    expect(screen.getByText("Checking your subscription…")).toBeTruthy();
    expect(screen.queryByText(/Live Trade workspace loaded/)).toBeNull();
  });
});
