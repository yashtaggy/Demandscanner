"use client";

import { useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, X } from "lucide-react";
import { OverviewShell } from "@/components/overview/app-shell";
import { SummaryCards } from "@/components/summary-cards";
import { StockTable } from "@/components/stock-table";
import { FilterBar } from "@/components/filter-bar";
import { ScannerPanel } from "@/components/scanner-panel";
import { useAppAuth } from "@/hooks/use-app-auth";
import { useStocks } from "@/hooks/use-stocks";
import { useSubscription } from "@/hooks/use-subscription";
import { SubscriptionAccessNotice } from "@/components/subscription/access-notice";

type SortField = "symbol" | "price" | "change" | "changePercent" | "volume";
type SortOrder = "asc" | "desc";

export default function DashboardPage() {
  const { user: appUser, loading: authLoading } = useAppAuth();
  const isAuthenticated = appUser !== null;
  const { data: subscription, loading: subscriptionLoading } =
    useSubscription(isAuthenticated);
  const accessBlocked =
    isAuthenticated &&
    !subscriptionLoading &&
    subscription !== null &&
    subscription.subscriptionRequired &&
    !subscription.entitled;

  // Portal target for the scanner trigger; the panel owns the button, the header owns the slot.
  const [scannerTriggerHost, setScannerTriggerHost] = useState<HTMLDivElement | null>(null);

  // ─── Filter/sort state ───────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortField>("symbol");
  const [order, setOrder] = useState<SortOrder>("asc");
  const [filter, setFilter] = useState<"all" | "positive" | "negative">("all");
  const [minChange, setMinChange] = useState(0);
  const [page, setPage] = useState(1);
  const [refreshInterval, setRefreshInterval] = useState(0);

  const PAGE_SIZE = 50;

  // ─── Data fetching ───────────────────────────────────────────────────────────
  const { stocks, meta, loading, error, lastFetchedAt, refetch } = useStocks({
    search,
    sort,
    order,
    filter,
    minChange,
    page,
    pageSize: PAGE_SIZE,
    refreshInterval,
    enabled: isAuthenticated,
  });

  // ─── Handlers ────────────────────────────────────────────────────────────────
  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sort) {
        setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSort(field);
        setOrder("asc");
      }
      setPage(1);
    },
    [sort]
  );

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleFilterChange = (v: "all" | "positive" | "negative") => {
    setFilter(v);
    setPage(1);
  };

  const handleMinChangeChange = (v: number) => {
    setMinChange(v);
    setPage(1);
  };

  return (
    <OverviewShell lastRefreshed={lastFetchedAt}>
      <main className="mx-auto w-full max-w-[1680px] px-4 pb-10 pt-5 sm:px-6 sm:pt-6 lg:px-8 min-[1440px]:pb-8">
        <div className="space-y-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--ds-text)] sm:text-[30px]">
                Overview
              </h1>
              <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-[var(--ds-text-muted)]">
                Nifty 500 snapshot with live quotes and the supply &amp; demand scanner.
              </p>
            </div>
            <div ref={setScannerTriggerHost} className="shrink-0 min-[1440px]:hidden" />
          </header>

          {/* Auth error banner */}
          <AuthErrorBanner />

          {accessBlocked ? (
            <SubscriptionAccessNotice current={subscription?.current ?? null} />
          ) : (
            <>
              {/* Not signed in */}
              {!isAuthenticated && !authLoading && <ConnectPrompt />}

              {/* Summary cards */}
              <SummaryCards
                instrumentsLoaded={meta?.instrumentsLoaded}
                symbolsWithQuotes={meta?.symbolsWithQuotes}
                matchingFilter={meta?.total}
                fetchedAt={lastFetchedAt}
                loading={isAuthenticated && loading && !meta}
              />

              {/* Main content: table + scanner panel */}
              <div className="flex flex-col gap-5 min-[1440px]:flex-row min-[1440px]:items-start">
                <section className="min-w-0 flex-1 space-y-4" aria-label="Nifty 500 stocks">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-[var(--ds-text)]">Nifty 500</h2>
                      {meta?.symbolsMatched != null && (
                        <span
                          className="ds-mono rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-[var(--ds-text-secondary)]"
                          style={{ background: "var(--ds-surface-subtle)" }}
                        >
                          {meta.symbolsMatched.toLocaleString("en-IN")} instruments
                        </span>
                      )}
                      {meta?.nifty500LastUpdated && (
                        <span className="hidden text-[10.5px] text-[var(--ds-text-muted)] sm:inline">
                          Constituents updated {meta.nifty500LastUpdated}
                        </span>
                      )}
                    </div>
                    {isAuthenticated && (
                      <span className="hidden text-[10.5px] text-[var(--ds-text-muted)] md:inline">
                        Polling via Kite REST — not real-time streaming
                      </span>
                    )}
                  </div>

                  {isAuthenticated && (
                    <FilterBar
                      search={search}
                      onSearchChange={handleSearchChange}
                      filter={filter}
                      onFilterChange={handleFilterChange}
                      minChange={minChange}
                      onMinChangeChange={handleMinChangeChange}
                      refreshInterval={refreshInterval}
                      onRefreshIntervalChange={setRefreshInterval}
                      onRefresh={refetch}
                      loading={loading}
                    />
                  )}

                  <StockTable
                    stocks={stocks}
                    loading={loading}
                    error={isAuthenticated ? error : null}
                    sort={sort}
                    order={order}
                    onSort={handleSort}
                    onRetry={refetch}
                    page={page}
                    totalPages={meta?.totalPages ?? 1}
                    total={meta?.total ?? 0}
                    onPageChange={setPage}
                  />
                </section>

                <ScannerPanel isAuthenticated={isAuthenticated} triggerHost={scannerTriggerHost} />
              </div>
            </>
          )}
        </div>
      </main>
    </OverviewShell>
  );
}

function AuthErrorBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const authError = searchParams.get("auth_error");

  if (!authError) return null;

  const messages: Record<string, string> = {
    missing_token: "Login failed: no request token was received from Zerodha.",
    session_failed: "Failed to establish a Kite session. Please try again.",
    login_failed: "Zerodha login was not completed.",
  };

  const message = messages[authError] ?? `Authentication error: ${authError}`;

  return (
    <div
      className="flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm"
      style={{ borderColor: "var(--ds-border)", background: "var(--ds-negative-soft)", color: "var(--ds-negative)" }}
      role="alert"
    >
      <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="flex-1">{message}</span>
      <button
        onClick={() => router.replace("/")}
        className="rounded-lg p-1 opacity-70 transition-opacity hover:opacity-100"
        id="dismiss-error-button"
        aria-label="Dismiss error"
      >
        <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

function ConnectPrompt() {
  return (
    <div
      className="space-y-4 rounded-2xl border p-6 text-center sm:p-8"
      style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
    >
      <div className="flex justify-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--ds-gold-50)", color: "var(--ds-gold-700)" }}
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-[var(--ds-text)]">Sign in to DemandScanner</h3>
        <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-[var(--ds-text-muted)]">
          Use the account your administrator provisioned. Market data is supplied by the
          platform, so you do not need your own broker login for the dashboard or scanner.
        </p>
      </div>
      <Link
        href="/login"
        id="sign-in-main-button"
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--ds-text)] px-5 text-sm font-semibold text-[var(--ds-surface)] transition-colors hover:bg-[#3a372e]"
      >
        Sign in
      </Link>
    </div>
  );
}
