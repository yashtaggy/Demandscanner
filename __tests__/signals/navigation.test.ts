import {
  canManageSignals,
  canOpenSignalsInbox,
  isNavItemActive,
  navigationItems,
} from "@/lib/navigation";

describe("role-based navigation", () => {
  it("shows only the shared entries when signed out", () => {
    const hrefs = navigationItems(null).map((item) => item.href);
    expect(hrefs).toEqual([
      "/",
      "/scanner",
      "/live-trade",
      "/account/subscription",
    ]);
    expect(hrefs).not.toContain("/signals");
    expect(hrefs).not.toContain("/admin/customers");
    expect(hrefs).not.toContain("/admin/signals");
  });

  it("gives customers their own Signals inbox and no administration links", () => {
    const items = navigationItems("CUSTOMER");
    const signals = items.find((item) => item.href === "/signals");
    expect(signals).toEqual({
      href: "/signals",
      label: "Signals",
      badge: "unread-signals",
    });
    expect(items.some((item) => item.href.startsWith("/admin"))).toBe(false);
  });

  it("gives ADMIN customer administration but not super-admin signal management", () => {
    const hrefs = navigationItems("ADMIN").map((item) => item.href);
    expect(hrefs).toContain("/admin/customers");
    expect(hrefs).not.toContain("/admin/signals");
    expect(hrefs).not.toContain("/signals");
  });

  it("gives SUPER_ADMIN both administration entries and no customer inbox", () => {
    const hrefs = navigationItems("SUPER_ADMIN").map((item) => item.href);
    expect(hrefs).toContain("/admin/customers");
    expect(hrefs).toContain("/admin/signals");
    expect(hrefs).not.toContain("/signals");
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("navigation access rules", () => {
  it("only admits customers to the inbox", () => {
    expect(canOpenSignalsInbox("CUSTOMER")).toBe(true);
    expect(canOpenSignalsInbox("ADMIN")).toBe(false);
    expect(canOpenSignalsInbox("SUPER_ADMIN")).toBe(false);
    expect(canOpenSignalsInbox(null)).toBe(false);
  });

  it("only admits super administrators to signal management", () => {
    expect(canManageSignals("SUPER_ADMIN")).toBe(true);
    expect(canManageSignals("ADMIN")).toBe(false);
    expect(canManageSignals("CUSTOMER")).toBe(false);
    expect(canManageSignals(null)).toBe(false);
  });
});

describe("active navigation matching", () => {
  it("keeps the dashboard exact and highlights nested paths for sections", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/", "/scanner")).toBe(false);
    expect(isNavItemActive("/signals", "/signals")).toBe(true);
    expect(isNavItemActive("/signals", "/signals/abc")).toBe(true);
    expect(isNavItemActive("/signals", "/signals-archive")).toBe(false);
    expect(isNavItemActive("/admin/signals", "/admin/signals/abc")).toBe(true);
    expect(isNavItemActive("/admin/signals", "/admin/customers")).toBe(false);
    expect(isNavItemActive("/admin/customers", "/admin/signals")).toBe(false);
  });
});
