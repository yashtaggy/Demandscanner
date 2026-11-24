"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Play, RefreshCw, RotateCcw } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { ScanBatchCounters, ScanJob } from "@/hooks/use-scanner-job";

interface ScanCompletionProps {
  job: ScanJob;
  batches?: ScanBatchCounters;
  zoneCount: number;
  launching: boolean;
  onRunScan: () => void;
  /** "scanner" replaces the link back to /scanner with an in-page refresh. */
  mode?: "overview" | "scanner";
  onRefreshResults?: () => void;
  refreshing?: boolean;
}

function durationLabel(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.round((end - start) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Completion summary built only from the persisted scan job and zone count. */
export function ScanCompletion({
  job,
  batches,
  zoneCount,
  launching,
  onRunScan,
  mode = "overview",
  onRefreshResults,
  refreshing = false,
}: ScanCompletionProps) {
  const duration = durationLabel(job.startedAt, job.completedAt);
  const scannerMode = mode === "scanner";

  return (
    <div
      className="rounded-xl border p-3.5"
      style={{
        borderColor: "color-mix(in srgb, var(--ds-positive) 30%, var(--ds-border))",
        background: "var(--ds-positive-soft)",
      }}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <CheckCircle2
          className="mt-0.5 h-4.5 w-4.5 shrink-0"
          style={{ color: "var(--ds-positive)" }}
          strokeWidth={1.9}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--ds-text)]">Scan complete</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ds-text-secondary)]">
            {job.processedInstruments > 0
              ? `${job.processedInstruments.toLocaleString("en-IN")} instruments processed`
              : "Scan finished"}
            {duration ? ` in ${duration}` : ""}
            {zoneCount > 0 ? ` · ${zoneCount.toLocaleString("en-IN")} zones available` : ""}
          </p>
          {job.completedAt && (
            <p className="ds-mono mt-1 text-[10.5px] text-[var(--ds-text-muted)]">
              Completed {formatDateTime(job.completedAt)}
            </p>
          )}
          {(batches?.failed ?? 0) > 0 && (
            <p className="mt-1 text-[10.5px] font-medium" style={{ color: "var(--ds-warning)" }}>
              {batches?.failed} batch{batches?.failed === 1 ? "" : "es"} reported a failure
            </p>
          )}
          {scannerMode && (
            <p className="mt-1 text-[10.5px] text-[var(--ds-text-muted)]">
              This summary reflects the scan that ran in this session.
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onRunScan}
              disabled={launching}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ds-text)] px-2.5 text-[11.5px] font-semibold text-[var(--ds-surface)] transition-colors hover:bg-[#3a372e] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {launching ? (
                <RotateCcw className="h-3 w-3 animate-spin" strokeWidth={2.25} aria-hidden="true" />
              ) : (
                <Play className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
              )}
              {launching
                ? "Starting…"
                : scannerMode
                  ? "Run another scan"
                  : "Start another scan"}
            </button>
            {scannerMode ? (
              <button
                type="button"
                onClick={onRefreshResults}
                disabled={!onRefreshResults || refreshing}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ds-border-strong)] bg-[var(--ds-surface-elevated)] px-2.5 text-[11.5px] font-semibold text-[var(--ds-text)] transition-colors hover:bg-[var(--ds-gold-50)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
                Refresh results
              </button>
            ) : (
              <Link
                href="/scanner"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ds-border-strong)] bg-[var(--ds-surface-elevated)] px-2.5 text-[11.5px] font-semibold text-[var(--ds-text)] transition-colors hover:bg-[var(--ds-gold-50)]"
              >
                Open Scanner
                <ArrowUpRight className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
