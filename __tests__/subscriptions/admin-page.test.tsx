/**
 * @jest-environment jsdom
 *
 * Admin console page gate. The server also enforces ADMIN/SUPER_ADMIN on every
 * /api/admin route; this test proves the page does not render administration
 * controls for a customer account.
 */

const mockAppAuth = jest.fn();
const mockAdminRequest = jest.fn();

jest.mock("@/hooks/use-app-auth", () => ({ useAppAuth: () => mockAppAuth() }));
jest.mock("@/components/admin/admin-client", () => ({
  adminRequest: (...args: unknown[]) => mockAdminRequest(...args),
  inputClass: "",
}));
jest.mock("@/components/header", () => ({ Header: () => null }));
jest.mock("@/components/admin/subscription-plans-panel", () => ({
  PlansPanel: ({ plans }: { plans: unknown[] }) => (
    <div>Plans panel ({plans.length})</div>
  ),
}));
jest.mock("@/components/admin/customers-panel", () => ({
  CustomersPanel: () => <div>Customers panel</div>,
}));

import { render, screen, waitFor } from "@testing-library/react";
import AdminConsolePage from "@/app/admin/customers/page";

const ADMIN = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "admin@example.com",
  displayName: "Admin",
  status: "ACTIVE" as const,
  role: "ADMIN" as const,
};

function auth(user: typeof ADMIN | null, loading = false) {
  return {
    user,
    loading,
    error: null,
    refetch: jest.fn(),
    logout: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAppAuth.mockReturnValue(auth(ADMIN));
  mockAdminRequest.mockResolvedValue({ plans: [{ planId: "p1" }] });
});

describe("AdminConsolePage", () => {
  it("asks a signed-out visitor to sign in with an administrator account", () => {
    mockAppAuth.mockReturnValue(auth(null));
    render(<AdminConsolePage />);
    expect(
      screen.getByText("Sign in with an administrator account")
    ).toBeTruthy();
    expect(screen.queryByText("Not authorized")).toBeNull();
  });

  it("refuses a customer account", () => {
    mockAppAuth.mockReturnValue(
      auth({ ...ADMIN, role: "CUSTOMER" as unknown as "ADMIN" })
    );
    render(<AdminConsolePage />);

    expect(screen.getByText("Not authorized")).toBeTruthy();
    expect(screen.queryByText("Customers panel")).toBeNull();
    expect(mockAdminRequest).not.toHaveBeenCalled();
  });

  it("renders the administration panels for an admin and loads plans", async () => {
    render(<AdminConsolePage />);

    expect(screen.getByText("ADMIN")).toBeTruthy();
    expect(screen.getByText("Add customer")).toBeTruthy();
    expect(screen.getByText("Customers panel")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("Plans panel (1)")).toBeTruthy()
    );
    expect(mockAdminRequest).toHaveBeenCalledWith(
      "/api/admin/subscription-plans",
      "GET"
    );
  });

  it("works for a super admin without a subscription", async () => {
    mockAppAuth.mockReturnValue(
      auth({ ...ADMIN, role: "SUPER_ADMIN" as unknown as "ADMIN" })
    );
    render(<AdminConsolePage />);

    expect(screen.getByText("SUPER_ADMIN")).toBeTruthy();
    expect(screen.getByText("Customers panel")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("Plans panel (1)")).toBeTruthy()
    );
  });
});
