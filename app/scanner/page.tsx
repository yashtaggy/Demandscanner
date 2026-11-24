"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play, RotateCcw } from "lucide-react";
import { OverviewShell } from "@/components/overview/app-shell";
import { useAppAuth } from "@/hooks/use-app-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { SubscriptionAccessNotice } from "@/components/subscription/access-notice";
import { useZones, DEFAULT_SCANNER_FILTERS, type ZoneFilters } from "@/hooks/use-zones";
import { useScannerJob } from "@/hooks/use-scanner-job";
import { ScanProgress } from "@/components/scanner/ScanProgress";
import { ScannerFilterBar } from "@/components/scanner/ScannerFilterBar";
import { ScannerActionsMenu } from "@/components/scanner/ScannerActionsMenu";
import { ZoneTable, type ZoneSortKey } from "@/components/scanner/ZoneTable";
import { ZoneDetailDrawer } from "@/components/scanner/ZoneDetailDrawer";
import { ScanCompletion } from "@/components/overview/scan-completion";
import { scanScopeLabel } from "@/lib/scanner/scan-scope";
import type { Zone } from "@/lib/scanner/types";

const PAGE_SIZE = 100;

const STATE_STYLE = {
  info: {
    color: "var(--ds-info)",
    background: "var(--ds-info-soft)",
    borderColor: "var(--ds-info)",
  },
  positive: {
    color: "var(--ds-positive)",
    background: "var(--ds-positive-soft)",
    borderColor: "var(--ds-positive)",
  },
  negative: {
    color: "var(--ds-negative)",
    background: "var(--ds-negative-soft)",
    borderColor: "var(--ds-negative)",
  },
};

export default function ScannerPage() {
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

  // ── Filter / pagination state ────────────────────────────────────────────
  const [filters, setFilters] = useState<ZoneFilters>({
    ...DEFAULT_SCANNER_FILTERS,
    limit: PAGE_SIZE,
  });
  const [page, setPage] = useState(1);

  const activeFilters: ZoneFilters = {
    ...filters,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  // ── Data hooks ───────────────────────────────────────────────────────────
  const { zones, count, loading, error, refetch } = useZones(
    isAuthenticated ? activeFilters : {}
  );
  const { job, batches, launching, resuming, launch, reset } = useScannerJob();

  const isRunning = job?.status === "RUNNING" || job?.status === "PENDING";
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  // Refresh the persisted zone list once when a scan reaches SUCCESS without
  // starting another scan or resetting the active filters.
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = job?.status ?? null;
    if (status === "SUCCESS" && prevStatusRef.current !== "SUCCESS") {
      refetch();
    }
    prevStatusRef.current = status;
  }, [job?.status, refetch]);

  // ── Drawer / utilities ───────────────────────────────────────────────────
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);

  function handleFiltersChange(f: ZoneFilters) {
    setFilters(f);
    setPage(1);
  }

  // Header sort uses the same filter state and offset reset as the sort control.
  function handleSortChange(key: ZoneSortKey) {
    const dir = filters.sort === key && filters.dir === "desc" ? "asc" : "desc";
    handleFiltersChange({ ...filters, sort: key, dir });
  }

  // Restores every user-adjustable filter to its default. This only changes
  // list-query state; it never starts, resumes, or cancels a scan.
  function handleResetFilters() {
    setFilters({ ...DEFAULT_SCANNER_FILTERS, limit: PAGE_SIZE });
    setPage(1);
  }

  // Export zones as JSON or CSV. The endpoint only honours timeframe, side,
  // lifecycle, minScore, limit and offset — the menu states this explicitly.
  async function handleExport(format: "json" | "csv") {
    const params = new URLSearchParams();
    if (filters.timeframe) params.set("timeframe", filters.timeframe);
    if (filters.side) params.set("side", filters.side);
    if (filters.lifecycle) params.set("lifecycle", filters.lifecycle);
    if (filters.minScore !== undefined) params.set("minScore", String(filters.minScore));
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.offset !== undefined) params.set("offset", String(filters.offset));

    setExporting(format);
    try {
      const url = `/api/scanner/export?${params.toString()}`;
      const accept = format === "csv" ? "text/csv" : "application/json";
      const res = await fetch(url, { headers: { accept } });
      if (!res.ok) throw new Error(`Export failed ${res.status}`);
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `zones.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(null);
    }
  }

  

  const isScanActive = launching || isRunning;
  const showCompletion = job?.status === "SUCCESS" && !launching;
  const tableSortKey: ZoneSortKey | undefined =
    filters.sort && filters.sort !== "composite_score" ? filters.sort : undefined;
  const rangeStart = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, count);

  const scanState =
    launching
      ? { label: "Starting scan", tone: "info" as const }
      : job?.status === "PENDING"
        ? { label: "Scan queued", tone: "info" as const }
        : job?.status === "RUNNING"
          ? { label: `Scanning ${job.progressPercent ?? 0}%`, tone: "info" as const }
          : job?.status === "SUCCESS"
            ? { label: "Last scan complete", tone: "positive" as const }
            : job?.status === "FAILED"
              ? { label: "Last scan failed", tone: "negative" as const }
              : null;

  function runScan() {
    void launch(filters.symbol ? { symbols: [filters.symbol] } : {});
  }

  return (
    <OverviewShell lastRefreshed={null}>
      <main className="mx-auto w-full max-w-[1680px] px-4 pb-10 pt-5 sm:px-6 sm:pt-6 lg:px-8">
        <div className="space-y-5">
          {/* ── Page identity and scan action ── */}
          <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--ds-text)] sm:text-[30px]">
                Scanner
              </h1>
              <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-[var(--ds-text-muted)]">
                Identify demand and supply zones across multiple market timeframes.
              </p>
            </div>

            <div className="flex flex-col gap-2 lg:items-end">
              <p className="ds-mono text-[10.5px] text-[var(--ds-text-muted)]">
                {scanScopeLabel(filters.symbol)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {scanState && (
                  <span
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold"
                    style={STATE_STYLE[scanState.tone]}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: STATE_STYLE[scanState.tone].color }}
                      aria-hidden="true"
                    />
                    {scanState.label}
                  </span>
                )}

                <ScannerActionsMenu
                  onRefresh={refetch}
                  refreshing={loading}
                  exporting={exporting}
                  onExport={handleExport}
                  disabled={!isAuthenticated || accessBlocked}
                />

                <button
                  type="button"
                  id="run-scan-btn"
                  onClick={runScan}
                  disabled={!isAuthenticated || accessBlocked || authLoading || isScanActive}
                  aria-busy={isScanActive}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--ds-gold-500)] bg-[var(--ds-gold-300)] px-4 text-[12.5px] font-bold text-[var(--ds-text)] transition-colors hover:bg-[var(--ds-gold-500)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-gold-700)] disabled:cursor-not-allowed disabled:opacity-55"
                  title={
                    !isAuthenticated
                      ? "Sign in to run the scanner"
                      : accessBlocked
                        ? "An active subscription is required"
                        : undefined
                  }
                >
                  {isScanActive ? (
                    <RotateCcw className="h-4 w-4 animate-spin" strokeWidth={2.25} aria-hidden="true" />
                  ) : (
                    <Play className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                  )}
                  {launching ? "Starting…" : isRunning ? "Scan running" : "Run scan"}
                </button>
              </div>
            </div>
          </header>

          {/* ── Not signed in ── */}
          {!isAuthenticated && !authLoading && <SignInNotice />}

          {/* ── Inactive subscription ── */}
          {isAuthenticated && accessBlocked && (
            <SubscriptionAccessNotice current={subscription?.current ?? null} />
          )}

          {isAuthenticated && !accessBlocked && (
            <>
              {/* ── Active scan status / completion ── */}
              {(launching || resuming || (job !== null && job.status !== "SUCCESS")) && (
                <ScanProgress
                  job={job}
                  launching={launching}
                  batches={batches}
                  resuming={resuming}
                  variant="light"
                  layout="wide"
                />
              )}

              {showCompletion && job && (
                <div className="space-y-1.5">
                  <ScanCompletion
                    job={job}
                    batches={batches}
                    zoneCount={count}
                    launching={launching}
                    onRunScan={runScan}
                    mode="scanner"
                    onRefreshResults={refetch}
                    refreshing={loading}
                  />
                  <div className="flex justify-end">
                    <ClearStatus onClear={reset} />
                  </div>
                </div>
              )}

              {job && !isScanActive && job.status !== "SUCCESS" && (
                <div className="flex justify-end">
                  <ClearStatus onClear={reset} />
                </div>
              )}

              {/* ── Primary filters ── */}
              <ScannerFilterBar
                filters={filters}
                onFiltersChange={handleFiltersChange}
                onResetFilters={handleResetFilters}
                isAuthenticated={isAuthenticated}
              />

              {/* ── Results ── */}
              <section aria-labelledby="zone-results-heading" className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <h2
                      id="zone-results-heading"
                      className="text-[15px] font-semibold text-[var(--ds-text)]"
                    >
                      Zone results
                    </h2>
                    <p className="mt-0.5 text-[11.5px] text-[var(--ds-text-muted)]">
                      {count.toLocaleString("en-IN")} zones match the current filters
                    </p>
                  </div>
                  <PageStats zones={zones} loading={loading} />
                </div>

                <ZoneTable
                  zones={zones}
                  loading={loading}
                  error={error}
                  onRetry={refetch}
                  onSelect={setSelectedZone}
                  variant="light"
                  enhanced
                  sortKey={tableSortKey}
                  sortDir={filters.dir ?? "desc"}
                  onSortChange={handleSortChange}
                />

                {totalPages > 1 && (
                  <div
                    className="flex flex-col items-center justify-between gap-2 rounded-2xl border px-4 py-3 sm:flex-row"
                    style={{
                      borderColor: "var(--ds-border)",
                      background: "var(--ds-surface)",
                    }}
                  >
                    <p className="ds-mono text-[11px] text-[var(--ds-text-muted)]">
                      <span>
                        {rangeStart.toLocaleString("en-IN")}–
                        {rangeEnd.toLocaleString("en-IN")} of {count.toLocaleString("en-IN")}
                      </span>
                      <span className="mx-2" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        Page {page} of {totalPages}
                      </span>
                    </p>
                    <nav className="flex items-center gap-1" aria-label="Zone results pagination">
                      <PaginationBtn
                        id="prev-page-btn"
                        ariaLabel="Previous page"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        label="← Prev"
                      />
                      <PaginationBtn
                        id="next-page-btn"
                        ariaLabel="Next page"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        label="Next →"
                      />
                    </nav>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {/* Single page-level drawer with light tokens; no table reflow. */}
      <ZoneDetailDrawer
        zone={selectedZone}
        onClose={() => setSelectedZone(null)}
        variant="light"
      />
    </OverviewShell>
  );
}

// ── Page-scoped result stats ──────────────────────────────────────────────────
// Every value describes the rows currently loaded on this page, never totals.
function PageStats({ zones, loading }: { zones: Zone[]; loading: boolean }) {
  const total = zones.length;
  const demand = zones.filter((z) => z.side === "DEMAND").length;
  const supply = zones.filter((z) => z.side === "SUPPLY").length;
  const fresh = zones.filter((z) => z.lifecycleState === "CONFIRMED_FRESH").length;
  const avgScore =
    total > 0 ? Math.round(zones.reduce((sum, z) => sum + z.score, 0) / total) : null;

  return (
    <dl className="flex min-h-[20px] flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ds-text-muted)]">
      <dt className="text-[9.5px] font-semibold uppercase tracking-[0.1em]">This page</dt>
      {total === 0 ? (
        <dd className="ds-mono">{loading ? "Loading…" : "No rows"}</dd>
      ) : (
        <>
          <PageStat label="Zones" value={total} color="var(--ds-text-secondary)" />
          <PageStat label="Demand" value={demand} color="var(--ds-positive)" />
          <PageStat label="Supply" value={supply} color="var(--ds-negative)" />
          <PageStat label="Fresh" value={fresh} color="var(--ds-info)" />
          <PageStat label="Avg score" value={avgScore ?? 0} color="var(--ds-gold-700)" />
        </>
      )}
    </dl>
  );
}

function PageStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt>{label}</dt>
      <dd className="ds-mono text-[11px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </dd>
    </div>
  );
}

function SignInNotice() {
  return (
    <div
      className="space-y-3 rounded-2xl border p-6 text-center"
      style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
    >
      <p className="text-[12.5px] leading-relaxed text-[var(--ds-text-secondary)]">
        Sign in to run the zone scanner and review persisted zones.
      </p>
      <Link
        href="/login"
        id="scanner-sign-in-btn"
        className="inline-flex h-9 items-center justify-center rounded-xl bg-[var(--ds-text)] px-4 text-[12px] font-semibold text-[var(--ds-surface)] transition-colors hover:bg-[#3a372e]"
      >
        Sign in
      </Link>
    </div>
  );
}

function ClearStatus({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="text-[11px] font-semibold text-[var(--ds-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--ds-text)]"
    >
      Clear status
    </button>
  );
}

function PaginationBtn({
  id,
  ariaLabel,
  disabled,
  onClick,
  label,
}: {
  id: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="ds-mono inline-flex h-8 items-center rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-3 text-[11px] font-medium text-[var(--ds-text-secondary)] transition-colors hover:border-[var(--ds-border-strong)] hover:text-[var(--ds-text)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}
