"use client";

import { useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Header } from "@/components/header";
import { SummaryCards } from "@/components/summary-cards";
import { StockTable } from "@/components/stock-table";
import { FilterBar } from "@/components/filter-bar";
import { ScannerPanel } from "@/components/scanner-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={lastFetchedAt} />

      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 py-6 space-y-6">
        {/* Auth error banner */}
        <AuthErrorBanner />

        {accessBlocked ? (
          <SubscriptionAccessNotice current={subscription?.current ?? null} />
        ) : (
          <>
        {/* Not connected state */}
        {!isAuthenticated && !authLoading && (
          <ConnectPrompt />
        )}

        {/* Summary cards */}
        <SummaryCards
          instrumentsLoaded={meta?.instrumentsLoaded}
          symbolsWithQuotes={meta?.symbolsWithQuotes}
          matchingFilter={meta?.total}
          fetchedAt={lastFetchedAt}
          loading={isAuthenticated && loading && !meta}
        />

        {/* Main content: table + scanner panel */}
        <div className="flex gap-6">
          {/* Left: table */}
          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-slate-100">Nifty 500</h2>
                {meta && (
                  <Badge variant="neutral" size="sm">
                    {meta.symbolsMatched} instruments
                  </Badge>
                )}
                {meta?.nifty500LastUpdated && (
                  <span className="text-xs text-slate-600 hidden sm:inline">
                    Constituents updated {meta.nifty500LastUpdated}
                  </span>
                )}
              </div>
              {isAuthenticated && (
                <span className="text-xs text-slate-600 hidden md:inline">
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
          </div>

          <aside className="hidden xl:block w-72 shrink-0">
            <ScannerPanel isAuthenticated={isAuthenticated} />
          </aside>
        </div>
          </>
        )}
      </main>
    </div>
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
    <div className="flex items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="flex-1">{message}</span>
      <button
        onClick={() => router.replace("/")}
        className="text-rose-400/60 hover:text-rose-400 transition-colors"
        id="dismiss-error-button"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function ConnectPrompt() {
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-8 text-center space-y-4">
      <div className="flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/15">
          <svg className="h-7 w-7 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">Sign in to DemandScan</h3>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          Use the account your administrator provisioned. Market data is supplied by the
          platform, so you do not need your own broker login for the dashboard or scanner.
        </p>
      </div>
      <Button
        variant="primary"
        size="lg"
        onClick={() => { window.location.href = "/login"; }}
        id="sign-in-main-button"
      >
        Sign in
      </Button>
    </div>
  );
}
