import type { AppUserRole } from "@/lib/auth/types";

export type NavBadge = "unread-signals";

export interface NavItem {
  href: string;
  label: string;
  badge?: NavBadge;
}

/**
 * Single source of truth for header navigation on desktop and mobile.
 *
 * Customers get their own Signals inbox. Only SUPER_ADMIN receives the
 * administrative Signals console; ADMIN keeps the existing customer admin
 * entry but must not see super-admin-only management destinations.
 */
export function navigationItems(
  role: AppUserRole | null | undefined
): NavItem[] {
  const items: NavItem[] = [
    { href: "/", label: "Dashboard" },
    { href: "/scanner", label: "Scanner" },
    { href: "/live-trade", label: "Live Trade" },
  ];

  if (role === "CUSTOMER") {
    items.push({ href: "/signals", label: "Signals", badge: "unread-signals" });
  }

  items.push({ href: "/account/subscription", label: "Subscription" });

  if (role === "ADMIN" || role === "SUPER_ADMIN") {
    items.push({ href: "/admin/customers", label: "Admin" });
  }
  if (role === "SUPER_ADMIN") {
    items.push({ href: "/admin/signals", label: "Signals" });
  }

  return items;
}

export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function canOpenSignalsInbox(role: AppUserRole | null | undefined): boolean {
  return role === "CUSTOMER";
}

export function canManageSignals(role: AppUserRole | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}
