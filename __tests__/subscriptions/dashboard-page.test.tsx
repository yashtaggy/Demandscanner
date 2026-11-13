/**
 * @jest-environment jsdom
 *
 * Dashboard subscription gate:
 *  - an entitled customer sees the market table and scanner panel;
 *  - an expired customer sees only the subscription notice, with no stock or
 *    scanner component mounted at all.
 */

const mockAppAuth = jest.fn();
const mockStocks = jest.fn();
const mockSubscription = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock("@/hooks/use-app-auth", () => ({ useAppAuth: () => mockAppAuth() }));
jest.mock("@/hooks/use-stocks", () => ({ useStocks: () => mockStocks() }));
jest.mock("@/hooks/use-subscription", () => ({
  useSubscription: () => mockSubscription(),
}));

jest.mock("@/components/header", () => ({ Header: () => null }));
jest.mock("@/components/summary-cards", () => ({
  SummaryCards: () => <div>Summary cards</div>,
}));
jest.mock("@/components/stock-table", () => ({
  StockTable: () => <div>Stock table</div>,
}));
jest.mock("@/components/filter-bar", () => ({
  FilterBar: () => <div>Filter bar</div>,
}));
jest.mock("@/components/scanner-panel", () => ({
  ScannerPanel: () => <div>Scanner panel</div>,
}));

import { render, screen } from "@testing-library/react";
import DashboardPage from "@/app/page";

const CUSTOMER = {
  userId: "bbbbbbbb-2222-4222-8222-222222222222",
  email: "customer@example.com",
  displayName: "Customer",
  status: "ACTIVE" as const,
  role: "CUSTOMER" as const,
};

function auth() {
  return {
    user: CUSTOMER,
    loading: false,
    error: null,
    refetch: jest.fn(),
    logout: jest.fn(),
  };
}

function stocks() {
  return {
    stocks: [],
    meta: { instrumentsLoaded: 500, symbolsWithQuotes: 500, total: 0 },
    loading: false,
    error: null,
    lastFetchedAt: null,
    refetch: jest.fn(),
  };
}

function subscription(entitled: boolean, loading = false) {
  return {
    data: {
      ok: true,
      subscriptionRequired: true,
      entitled,
      today: "2026-11-13",
      current: entitled
        ? null
        : {
            planName: "Monthly",
            startDate: "2026-11-01",
            endDate: "2026-11-10",
            effectiveStatus: "EXPIRED",
          },
      history: [],
      payments: [],
    },
    loading,
    error: null,
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAppAuth.mockReturnValue(auth());
  mockStocks.mockReturnValue(stocks());
  mockSubscription.mockReturnValue(subscription(true));
});

describe("DashboardPage subscription gate", () => {
  it("renders market data for an entitled customer", () => {
    render(<DashboardPage />);

    expect(screen.getByText("Stock table")).toBeTruthy();
    expect(screen.getByText("Scanner panel")).toBeTruthy();
    expect(screen.queryByText("Subscription inactive")).toBeNull();
  });

  it("replaces every data component with the notice when not entitled", () => {
    mockSubscription.mockReturnValue(subscription(false));
    render(<DashboardPage />);

    expect(screen.getByText("Subscription inactive")).toBeTruthy();
    expect(screen.getByText(/Your subscription ended on 2026-11-10/)).toBeTruthy();
    expect(screen.queryByText("Stock table")).toBeNull();
    expect(screen.queryByText("Scanner panel")).toBeNull();
    expect(screen.queryByText("Summary cards")).toBeNull();
    expect(screen.queryByText("Filter bar")).toBeNull();
  });

  it("shows the checking state while the subscription request is in flight", () => {
    // The loading state renders the normal layout, not the block; the server
    // still rejects any request that arrives before entitlement is known.
    mockSubscription.mockReturnValue(subscription(false, true));
    render(<DashboardPage />);

    expect(screen.queryByText("Subscription inactive")).toBeNull();
  });
});
