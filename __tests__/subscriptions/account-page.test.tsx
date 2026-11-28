/**
 * @jest-environment jsdom
 *
 * Customer-facing subscription status page. It must explain the state without
 * exposing product data and must never offer an online payment flow.
 */

const mockAppAuth = jest.fn();
const mockSubscription = jest.fn();

jest.mock("@/hooks/use-app-auth", () => ({ useAppAuth: () => mockAppAuth() }));
jest.mock("@/hooks/use-subscription", () => ({
  useSubscription: () => mockSubscription(),
}));
jest.mock("@/components/overview/app-shell", () => ({
  OverviewShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { render, screen } from "@testing-library/react";
import AccountSubscriptionPage from "@/app/account/subscription/page";

const CUSTOMER = {
  userId: "bbbbbbbb-2222-4222-8222-222222222222",
  email: "customer@example.com",
  displayName: "Customer",
  status: "ACTIVE" as const,
  role: "CUSTOMER" as const,
};

const SUBSCRIPTION = {
  subscriptionId: "eeeeeeee-5555-4555-8555-555555555555",
  userId: CUSTOMER.userId,
  planId: "dddddddd-4444-4444-8444-444444444444",
  planName: "Monthly",
  planPrice: "499.00",
  planCurrency: "INR",
  startDate: "2026-11-01",
  endDate: "2026-12-31",
  status: "ACTIVE",
  effectiveStatus: "REMOVED_FOR_TEST",
  daysRemaining: 49,
  activatedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  renewedFromSubscriptionId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
};

function auth(user: typeof CUSTOMER | null) {
  return {
    user,
    loading: false,
    error: null,
    refetch: jest.fn(),
    logout: jest.fn(),
  };
}

function subscription(
  data: Record<string, unknown> | null,
  extras: { loading?: boolean; error?: string | null } = {}
) {
  return {
    data,
    loading: extras.loading ?? false,
    error: extras.error ?? null,
    refetch: jest.fn(),
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    user: CUSTOMER,
    subscriptionRequired: true,
    entitled: true,
    today: "2026-11-13",
    current: { ...SUBSCRIPTION, effectiveStatus: "ACTIVE" },
    history: [{ ...SUBSCRIPTION, effectiveStatus: "ACTIVE" }],
    payments: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAppAuth.mockReturnValue(auth(CUSTOMER));
  mockSubscription.mockReturnValue(subscription(payload()));
});

describe("AccountSubscriptionPage", () => {
  it("asks a signed-out visitor to sign in", () => {
    mockAppAuth.mockReturnValue(auth(null));
    render(<AccountSubscriptionPage />);
    expect(screen.getByText("Sign in to view your subscription")).toBeTruthy();
  });

  it("shows plan dates, inclusive expiry and remaining days", () => {
    render(<AccountSubscriptionPage />);

    expect(screen.getAllByText("Monthly").length).toBeGreaterThan(0);
    expect(screen.getByText("Access active")).toBeTruthy();
    expect(screen.getByText("Activated")).toBeTruthy();
    expect(screen.getByText("Expires (inclusive)")).toBeTruthy();
    expect(screen.getAllByText("2026-12-31").length).toBeGreaterThan(0);
    expect(screen.getByText("49 days")).toBeTruthy();
    expect(screen.getByText("Today (IST)")).toBeTruthy();
    expect(screen.getByText("2026-11-13")).toBeTruthy();
  });

  it("points customers to the administrator instead of an online payment", () => {
    render(<AccountSubscriptionPage />);

    expect(
      screen.getByText(/Payments are entered\s+manually by an administrator/)
    ).toBeTruthy();
    expect(screen.getByText(/there is no online payment/)).toBeTruthy();
    expect(
      screen.getByText(/To change or renew your plan, contact your DemandScan\s+administrator\./)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pay|checkout|razorpay/i })).toBeNull();
  });

  it("explains an inactive plan and retains history", () => {
    mockSubscription.mockReturnValue(
      subscription(
        payload({
          entitled: false,
          current: {
            ...SUBSCRIPTION,
            effectiveStatus: "EXPIRED",
            endDate: "2026-11-10",
            daysRemaining: 0,
          },
          history: [
            {
              ...SUBSCRIPTION,
              effectiveStatus: "CANCELLED",
              cancellationReason: "Customer request",
            },
          ],
        })
      )
    );
    render(<AccountSubscriptionPage />);

    expect(screen.getByText("Access inactive")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(
      screen.getByText(/This plan is not currently providing access/)
    ).toBeTruthy();
    expect(screen.getByText("Subscription history")).toBeTruthy();
    expect(screen.getByText("Customer request")).toBeTruthy();
  });

  it("states that no subscription is assigned", () => {
    mockSubscription.mockReturnValue(
      subscription(payload({ entitled: false, current: null, history: [] }))
    );
    render(<AccountSubscriptionPage />);

    expect(
      screen.getByText(/No subscription is assigned to your account\./)
    ).toBeTruthy();
    expect(screen.queryByText("Subscription history")).toBeNull();
  });

  it("does not present an administrator as a customer subscription", () => {
    mockAppAuth.mockReturnValue(
      auth({ ...CUSTOMER, role: "ADMIN" as unknown as "CUSTOMER" })
    );
    mockSubscription.mockReturnValue(
      subscription(payload({ subscriptionRequired: false, current: null, history: [] }))
    );
    render(<AccountSubscriptionPage />);

    expect(screen.getByText("Administrator account")).toBeTruthy();
    expect(screen.queryByText("Payment records")).toBeNull();
  });

  it("surfaces a load failure with a retry", () => {
    mockSubscription.mockReturnValue(
      subscription(null, { error: "Could not load your subscription." })
    );
    render(<AccountSubscriptionPage />);

    expect(screen.getByText("Could not load your subscription.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
