"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartCandlestick,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  ScanSearch,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { useAppAuth, type AppUser } from "@/hooks/use-app-auth";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { isNavItemActive, navigationItems } from "@/lib/navigation";
import { formatDateTime } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Administrator",
  CUSTOMER: "Customer",
};

const EXPANDED_WIDTH = 248;
const COLLAPSED_WIDTH = 76;

type IconComponent = typeof LayoutDashboard;

const ICONS: Record<string, IconComponent> = {
  "/": LayoutDashboard,
  "/scanner": ScanSearch,
  "/live-trade": ChartCandlestick,
  "/signals": Inbox,
  "/account/subscription": CreditCard,
  "/admin/customers": Users,
  "/admin/signals": Megaphone,
};

function iconFor(href: string): IconComponent {
  return ICONS[href] ?? LayoutDashboard;
}

function displayName(user: AppUser): string {
  return user.displayName?.trim() || user.email;
}

function initialFor(user: AppUser): string {
  const name = displayName(user).trim();
  return name.charAt(0).toUpperCase() || "D";
}

export function OverviewShell({
  lastRefreshed,
  children,
}: {
  lastRefreshed: string | null;
  children: React.ReactNode;
}) {
  const { status, loading: kiteLoading } = useAuth();
  const { user: appUser, loading: appLoading, logout } = useAppAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const unreadCount = useUnreadCount(appUser?.role === "CUSTOMER");
  const market = status?.market;
  const kiteConnected = status?.authenticated ?? false;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  const navItems = navigationItems(appUser?.role);

  return (
    <div
      className="ds-app min-h-screen"
      style={
        {
          "--ds-sidebar-width": `${collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH}px`,
        } as React.CSSProperties
      }
    >
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r transition-[width] duration-200 ease-out lg:flex"
        style={{
          width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
          background: "var(--ds-gold-50)",
          borderColor: "var(--ds-border)",
        }}
        aria-label="Primary navigation"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 px-4">
          {/* Logo area intentionally blank until brand artwork is supplied. */}
          <span className="h-9 w-9 shrink-0" aria-hidden="true" />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold tracking-tight text-[var(--ds-text)]">
                DemandScanner
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--ds-text-muted)]">
                Clarity in every market decision.
              </span>
            </span>
          )}
        </div>

        <nav className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {navItems.map((item) => {
            const Icon = iconFor(item.href);
            const active = isNavItemActive(item.href, pathname);
            const showSignalBadge =
              item.badge === "unread-signals" &&
              unreadCount !== null &&
              unreadCount > 0;
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
                className={`ds-nav-item group relative flex min-h-11 items-center rounded-xl text-[13px] font-semibold transition-colors ${
                  collapsed ? "justify-center px-0" : "gap-3 px-3"
                } ${
                  active
                    ? "bg-[var(--ds-gold-100)] text-[var(--ds-text)]"
                    : "text-[var(--ds-text-secondary)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]"
                }`}
                style={
                  active
                    ? { boxShadow: "inset 3px 0 0 var(--ds-gold-500)" }
                    : undefined
                }
              >
                <Icon
                  className="h-[18px] w-[18px] shrink-0"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                {!collapsed && (
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                )}
                {showSignalBadge && (
                  <span
                    className={
                      collapsed
                        ? "absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--ds-negative)]"
                        : "rounded-full bg-[var(--ds-negative-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ds-negative)] ds-mono"
                    }
                    aria-label={`${unreadCount} unread signals`}
                  >
                    {collapsed ? "" : unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
                {collapsed && <span className="ds-tooltip">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div
          className="shrink-0 border-t p-3"
          style={{ borderColor: "var(--ds-border)" }}
        >
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={`flex min-h-10 w-full items-center rounded-lg text-[12px] font-semibold text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-gold-100)] hover:text-[var(--ds-text)] ${
              collapsed ? "justify-center" : "gap-2.5 px-2.5"
            }`}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Collapse
              </>
            )}
          </button>
        </div>
      </aside>

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        pathname={pathname}
        appUser={appUser}
        unreadCount={unreadCount}
        onLogout={handleLogout}
        loggingOut={loggingOut}
      />

      <div className="ds-shell-main">
        <TopBar
          lastRefreshed={lastRefreshed}
          market={market}
          kiteLoading={kiteLoading}
          kiteConnected={kiteConnected}
          appLoading={appLoading}
          appUser={appUser}
          onOpenNav={() => setMobileNavOpen(true)}
          onLogout={handleLogout}
          loggingOut={loggingOut}
        />
        {children}
      </div>
    </div>
  );
}

function TopBar({
  lastRefreshed,
  market,
  kiteLoading,
  kiteConnected,
  appLoading,
  appUser,
  onOpenNav,
  onLogout,
  loggingOut,
}: {
  lastRefreshed: string | null;
  market: { isOpen: boolean; exchange: string } | undefined;
  kiteLoading: boolean;
  kiteConnected: boolean;
  appLoading: boolean;
  appUser: AppUser | null;
  onOpenNav: () => void;
  onLogout: () => Promise<void>;
  loggingOut: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      className="sticky top-0 z-30 border-b"
      style={{
        borderColor: "var(--ds-border)",
        background: "color-mix(in srgb, var(--ds-surface) 88%, transparent)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-2 px-3 sm:px-5 lg:px-8">
        <button
          type="button"
          onClick={onOpenNav}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-surface-subtle)] lg:hidden"
          style={{ borderColor: "var(--ds-border)" }}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <span
            className="inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold"
            style={{
              borderColor: market?.isOpen
                ? "var(--ds-positive)"
                : "var(--ds-border)",
              color: market?.isOpen
                ? "var(--ds-positive)"
                : "var(--ds-text-muted)",
              background: market?.isOpen
                ? "var(--ds-positive-soft)"
                : "var(--ds-surface-subtle)",
            }}
            title={market ? `NSE market is ${market.isOpen ? "open" : "closed"}` : undefined}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: market?.isOpen
                  ? "var(--ds-positive)"
                  : "var(--ds-text-muted)",
              }}
              aria-hidden="true"
            />
            {market ? `${market.exchange} ${market.isOpen ? "Open" : "Closed"}` : "NSE —"}
          </span>

          {lastRefreshed && (
            <span className="hidden min-w-0 truncate text-[11px] font-medium text-[var(--ds-text-muted)] md:inline">
              Updated{" "}
              <span className="ds-mono text-[11px]">
                {formatDateTime(lastRefreshed)}
              </span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!kiteLoading &&
            (kiteConnected ? (
              <span
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold"
                style={{
                  borderColor: "var(--ds-positive)",
                  color: "var(--ds-positive)",
                  background: "var(--ds-positive-soft)",
                }}
              >
                <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Kite connected</span>
                <span className="sm:hidden">Kite</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  window.location.href = "/api/kite/login";
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-surface-subtle)]"
                style={{ borderColor: "var(--ds-border)" }}
                title="Connect Kite for broker features such as Live Trade"
              >
                <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                Connect Kite
              </button>
            ))}

          {appLoading ? (
            <span className="h-8 w-24 animate-pulse rounded-full bg-[var(--ds-surface-subtle)]" />
          ) : appUser ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-10 items-center gap-2 rounded-full border pl-1 pr-2 text-left transition-colors hover:bg-[var(--ds-surface-subtle)] sm:pr-3"
                style={{ borderColor: "var(--ds-border)" }}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{
                    background: "var(--ds-gold-100)",
                    color: "var(--ds-gold-700)",
                  }}
                  aria-hidden="true"
                >
                  {initialFor(appUser)}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block max-w-[150px] truncate text-[12px] font-semibold text-[var(--ds-text)]">
                    {displayName(appUser)}
                  </span>
                  <span className="block text-[10px] font-medium text-[var(--ds-text-muted)]">
                    {ROLE_LABELS[appUser.role] ?? appUser.role}
                  </span>
                </span>
                <ChevronDown
                  className="h-3.5 w-3.5 text-[var(--ds-text-muted)]"
                  aria-hidden="true"
                />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="ds-fade-in absolute right-0 top-[calc(100%+8px)] w-[264px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border shadow-2xl"
                  style={{
                    borderColor: "var(--ds-border)",
                    background: "color-mix(in srgb, var(--ds-surface-elevated) 94%, transparent)",
                    backdropFilter: "blur(18px)",
                    WebkitBackdropFilter: "blur(18px)",
                    boxShadow: "var(--ds-shadow-float)",
                  }}
                >
                  <div className="border-b px-4 py-3" style={{ borderColor: "var(--ds-border)" }}>
                    <p className="truncate text-[13px] font-semibold text-[var(--ds-text)]">
                      {displayName(appUser)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--ds-text-muted)]">
                      {appUser.email}
                    </p>
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ds-gold-700)]">
                      {ROLE_LABELS[appUser.role] ?? appUser.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void onLogout()}
                    disabled={loggingOut}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[12px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)] disabled:opacity-60"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {loggingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                window.location.href = "/login";
              }}
              className="inline-flex h-9 items-center rounded-full px-3.5 text-[12px] font-semibold text-[var(--ds-surface)]"
              style={{ background: "var(--ds-text)" }}
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function MobileNavDrawer({
  open,
  onClose,
  pathname,
  appUser,
  unreadCount,
  onLogout,
  loggingOut,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  appUser: AppUser | null;
  unreadCount: number | null;
  onLogout: () => Promise<void>;
  loggingOut: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0"
        style={{ background: "rgb(41 39 32 / 0.36)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="ds-drawer-enter absolute inset-y-0 left-0 flex w-[min(86vw,300px)] flex-col border-r"
        style={{
          background: "var(--ds-gold-50)",
          borderColor: "var(--ds-border)",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {/* Logo area intentionally blank until brand artwork is supplied. */}
            <span className="h-9 w-9" aria-hidden="true" />
            <span>
              <span className="block text-[15px] font-bold tracking-tight text-[var(--ds-text)]">
                DemandScanner
              </span>
              <span className="mt-0.5 block text-[11px] font-medium text-[var(--ds-text-muted)]">
                Clarity in every market decision.
              </span>
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border text-[var(--ds-text-secondary)]"
            style={{ borderColor: "var(--ds-border)" }}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {navigationItems(appUser?.role).map((item) => {
            const Icon = iconFor(item.href);
            const active = isNavItemActive(item.href, pathname);
            const showSignalBadge =
              item.badge === "unread-signals" &&
              unreadCount !== null &&
              unreadCount > 0;
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`mb-1 flex min-h-12 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-colors ${
                  active
                    ? "bg-[var(--ds-gold-100)] text-[var(--ds-text)]"
                    : "text-[var(--ds-text-secondary)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]"
                }`}
                style={
                  active
                    ? { boxShadow: "inset 3px 0 0 var(--ds-gold-500)" }
                    : undefined
                }
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {showSignalBadge && (
                  <span className="rounded-full bg-[var(--ds-negative-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ds-negative)] ds-mono">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {appUser && (
          <div
            className="border-t p-3"
            style={{ borderColor: "var(--ds-border)" }}
          >
            <p className="truncate px-2 text-[12px] font-semibold text-[var(--ds-text)]">
              {displayName(appUser)}
            </p>
            <p className="truncate px-2 text-[11px] text-[var(--ds-text-muted)]">
              {appUser.email}
            </p>
            <button
              type="button"
              onClick={() => void onLogout()}
              disabled={loggingOut}
              className="mt-2 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-[12px] font-semibold text-[var(--ds-text-secondary)] hover:bg-[var(--ds-gold-100)] disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
