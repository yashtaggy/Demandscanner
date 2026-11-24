"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  PanelRightClose,
  RefreshCw,
  ScanLine,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useZones, DEFAULT_SCANNER_FILTERS, type ZoneFilters } from "@/hooks/use-zones";
import { useScannerJob } from "@/hooks/use-scanner-job";
import { ScanProgress } from "@/components/scanner/ScanProgress";
import { ScannerControls } from "@/components/scanner/ScannerControls";
import { ZoneTable } from "@/components/scanner/ZoneTable";
import { ScanCompletion } from "@/components/overview/scan-completion";

interface ScannerPanelProps {
  isAuthenticated: boolean;
  /** In-flow header slot owned by the page; the overlay trigger is portalled here. */
  triggerHost?: HTMLElement | null;
}

const SURFACE = {
  borderColor: "var(--ds-border)",
  background: "var(--ds-surface)",
  boxShadow: "var(--ds-shadow-card)",
};

export function ScannerPanel({ isAuthenticated, triggerHost }: ScannerPanelProps) {
  const [filters, setFilters] = useState<ZoneFilters>({
    ...DEFAULT_SCANNER_FILTERS,
    limit: 50,
  });
  const { zones, count, loading, error, refetch } = useZones(
    isAuthenticated ? filters : {}
  );
  const { job, batches, launching, resuming, launch } = useScannerJob();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isRunning = job?.status === "RUNNING" || job?.status === "PENDING";
  const isComplete = job?.status === "SUCCESS";
  const pct = job?.progressPercent ?? 0;

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  // The panel becomes an inline column at 1440px; close the overlay so its
  // scroll lock cannot survive the resize.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1440px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const runScan = () => {
    void launch(filters.symbol ? { symbols: [filters.symbol] } : {});
  };

  return (
    <>
      {/* Collapsed desktop rail */}
      {collapsed && (
        <aside
          className="hidden min-[1440px]:flex min-[1440px]:w-[64px] min-[1440px]:shrink-0 min-[1440px]:flex-col min-[1440px]:items-center min-[1440px]:gap-4 min-[1440px]:rounded-2xl min-[1440px]:border min-[1440px]:py-3"
          style={SURFACE}
          aria-label="Collapsed zone scanner"
        >
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand scanner panel"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]"
          >
            <PanelRightClose className="h-4 w-4 rotate-180" strokeWidth={1.75} aria-hidden="true" />
          </button>

          <div className="flex flex-col items-center gap-2">
            <ScanLine className="h-4 w-4 text-[var(--ds-text-muted)]" strokeWidth={1.75} aria-hidden="true" />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ds-text-muted)]"
              style={{ writingMode: "vertical-rl" }}
            >
              Scanner
            </span>
          </div>

          <div className="mt-auto flex flex-col items-center gap-2 pb-1">
            {isRunning && (
              <>
                <span className="scanner-spinner text-[var(--ds-gold-700)]" aria-hidden="true" />
                <span className="ds-mono text-[10px] text-[var(--ds-text-secondary)]">{pct}%</span>
              </>
            )}
            {isComplete && (
              <CheckCircle2
                className="h-4 w-4"
                style={{ color: "var(--ds-positive)" }}
                strokeWidth={2}
                aria-label="Scan complete"
              />
            )}
            {count > 0 && (
              <span className="ds-mono text-[10px] text-[var(--ds-text-muted)]">{count}</span>
            )}
          </div>
        </aside>
      )}

      {/* Panel: inline right column on large desktop, overlay drawer below 1440 */}
      <aside
        className={cn(
          "fixed inset-0 z-50",
          mobileOpen ? "block" : "hidden",
          collapsed ? "min-[1440px]:hidden" : "min-[1440px]:block",
          "min-[1440px]:sticky min-[1440px]:inset-auto min-[1440px]:top-20 min-[1440px]:z-30 min-[1440px]:w-[340px] min-[1440px]:shrink-0"
        )}
        aria-label="Zone scanner"
      >
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close scanner panel"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px] min-[1440px]:hidden"
          />
        )}

        <div
          className={cn(
            "relative flex h-full w-full flex-col overflow-y-auto border",
            "bg-[var(--ds-surface)] min-[1440px]:h-auto min-[1440px]:max-h-[calc(100vh-6rem)] min-[1440px]:rounded-2xl",
            "sm:ml-auto sm:max-w-[440px] sm:border-l min-[1440px]:max-w-none"
          )}
          style={{ borderColor: "var(--ds-border)", boxShadow: "var(--ds-shadow-float)" }}
        >
          {/* Header */}
          <div
            className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b px-4 py-3 backdrop-blur"
            style={{
              borderColor: "var(--ds-border)",
              background: "color-mix(in srgb, var(--ds-surface) 92%, transparent)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "var(--ds-gold-50)", color: "var(--ds-gold-700)" }}
              >
                <ScanLine className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[13.5px] font-semibold leading-tight text-[var(--ds-text)]">
                  Zone Scanner
                </h2>
                <p className="truncate text-[10.5px] text-[var(--ds-text-muted)]">
                  Supply &amp; demand · multi-timeframe
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {count > 0 && (
                <span
                  className="ds-mono rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{ background: "var(--ds-surface-subtle)", color: "var(--ds-text-secondary)" }}
                >
                  {count.toLocaleString("en-IN")} zones
                </span>
              )}
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse scanner panel"
                className="hidden h-8 w-8 items-center justify-center rounded-lg text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)] min-[1440px]:flex"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close scanner panel"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)] min-[1440px]:hidden"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="space-y-4 px-4 py-4">
            {!isAuthenticated ? (
              <div className="space-y-2 rounded-xl border px-4 py-6 text-center" style={{ borderColor: "var(--ds-border)" }}>
                <p className="text-[12.5px] text-[var(--ds-text-secondary)]">
                  Sign in to run the zone scanner.
                </p>
                <Link
                  href="/login"
                  className="inline-flex h-8 items-center rounded-lg bg-[var(--ds-text)] px-3 text-[11.5px] font-semibold text-[var(--ds-surface)]"
                >
                  Sign in
                </Link>
              </div>
            ) : (
              <>
                {isComplete && job ? (
                  <ScanCompletion
                    job={job}
                    batches={batches}
                    zoneCount={count}
                    launching={launching}
                    onRunScan={runScan}
                  />
                ) : (
                  <ScanProgress
                    job={job}
                    launching={launching}
                    batches={batches}
                    resuming={resuming}
                    variant="light"
                  />
                )}

                <ScannerControls
                  filters={filters}
                  onFiltersChange={setFilters}
                  onResetFilters={() => setFilters({ ...DEFAULT_SCANNER_FILTERS, limit: 50 })}
                  onRunScan={runScan}
                  onRefreshZones={refetch}
                  isRunning={isRunning}
                  launching={launching}
                  isAuthenticated={isAuthenticated}
                  runSymbol={filters.symbol}
                  collapsibleSections
                  variant="light"
                />

                <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--ds-border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--ds-text-muted)]">
                      Zones
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={refetch}
                        aria-label="Refresh zones"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)]"
                      >
                        <RefreshCw
                          className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </button>
                      <Link
                        href="/scanner"
                        className="inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[10.5px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]"
                        style={{ borderColor: "var(--ds-border)" }}
                      >
                        Open Scanner
                        <ArrowUpRight className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
                      </Link>
                    </div>
                  </div>

                  <ZoneTable
                    zones={zones}
                    loading={loading}
                    error={error}
                    onRetry={refetch}
                    variant="light"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Trigger below 1440 — rendered into the page header so it cannot float over content. */}
      {triggerHost &&
        createPortal(
          <button
            type="button"
            id="open-scanner-drawer"
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--ds-text)] px-4 text-[12.5px] font-semibold text-[var(--ds-surface)] shadow-[var(--ds-shadow-card)] transition-colors hover:bg-[#3a372e] min-[1440px]:hidden"
            aria-haspopup="dialog"
          >
            <ScanLine className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Scanner
            {isRunning && (
              <span className="ds-mono rounded-full bg-white/15 px-1.5 py-0.5 text-[10.5px]">{pct}%</span>
            )}
            {isComplete && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--ds-positive)" }}
                aria-label="Scan complete"
              />
            )}
          </button>,
          triggerHost
        )}
    </>
  );
}
