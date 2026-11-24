"use client";

import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ScanJob, ScanBatchCounters } from "@/hooks/use-scanner-job";
import { cn } from "@/lib/utils";

interface ScanProgressProps {
  job: ScanJob | null;
  launching: boolean;
  batches?: ScanBatchCounters;
  resuming?: boolean;
  /** Light presentation tokens for the Overview panel. */
  variant?: "dark" | "light";
  /** Inline compact strip (Overview panel) or the wide Scanner page section. */
  layout?: "compact" | "wide";
}

const STAGE_LABELS: Record<string, string> = {
  SYNC_INSTRUMENTS: "Syncing Nifty 500 universe",
  INGEST_DAILY: "Ingesting daily candles",
  INGEST_HOURLY: "Ingesting hourly candles",
  AGGREGATE_DAILY: "Aggregating weekly → yearly",
  AGGREGATE_4H: "Aggregating 4H sessions",
  DETECT_ZONES: "Detecting zones (8 timeframes)",
  LIFECYCLE: "Updating zone lifecycles",
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ScanProgress({
  job,
  launching,
  batches,
  resuming,
  variant = "dark",
  layout = "compact",
}: ScanProgressProps) {
  const [metricsOpen, setMetricsOpen] = useState(false);

  if (!job && !launching && !resuming) return null;

  const light = variant === "light";
  const pct = job?.progressPercent ?? 0;
  const status = job?.status ?? (launching ? "PENDING" : null);
  const launchError = !status && job?.errorMessage;

  const statusColor = {
    PENDING: light ? "text-[var(--ds-warning)]" : "text-amber-400",
    RUNNING: light ? "text-[var(--ds-info)]" : "text-indigo-400",
    SUCCESS: light ? "text-[var(--ds-positive)]" : "text-emerald-400",
    FAILED: light ? "text-[var(--ds-negative)]" : "text-rose-400",
  }[status ?? "PENDING"] ?? (light ? "text-[var(--ds-text-secondary)]" : "text-slate-400");

  const muted = light ? "text-[var(--ds-text-muted)]" : "text-slate-500";
  const secondary = light ? "text-[var(--ds-text-secondary)]" : "text-slate-400";
  const faint = light ? "text-[var(--ds-text-muted)]" : "text-slate-600";
  const errorText = light ? "text-[var(--ds-negative)]" : "text-rose-400";
  const retryText = light ? "text-[var(--ds-warning)]" : "text-amber-400";

  const statusLabel = resuming
    ? "Resuming existing scan…"
    : launchError
      ? "Unable to start scan"
      : {
          PENDING: "Queued…",
          RUNNING: `Scanning… ${pct}%`,
          SUCCESS: "Scan complete",
          FAILED: "Scan failed",
        }[status ?? "PENDING"] ?? "Working…";

  const barColor = {
    PENDING: light ? "bg-[var(--ds-warning)]" : "bg-amber-500",
    RUNNING: light ? "bg-[var(--ds-info)]" : "bg-indigo-500",
    SUCCESS: light ? "bg-[var(--ds-positive)]" : "bg-emerald-500",
    FAILED: light ? "bg-[var(--ds-negative)]" : "bg-rose-500",
  }[status ?? "PENDING"] ?? (light ? "bg-[var(--ds-text-muted)]" : "bg-slate-500");

  const startedAt = job?.startedAt ? new Date(job.startedAt).getTime() : NaN;
  const completedAt = job?.completedAt ? new Date(job.completedAt).getTime() : NaN;
  // Elapsed time for an in-flight scan intentionally tracks the current clock.
  // eslint-disable-next-line react-hooks/purity
  const endAt = Number.isFinite(completedAt) ? completedAt : Date.now();
  const elapsedMs = Number.isFinite(startedAt) ? endAt - startedAt : NaN;

  const total = job?.totalInstruments ?? 0;
  const processed = job?.processedInstruments ?? 0;
  const batchesCompleted = batches?.completed ?? 0;

  // Coarse whole-job estimate from persisted progress. Only shown while
  // running with enough progress for the extrapolation to mean anything.
  const etaMs =
    status === "RUNNING" && pct >= 5 && pct < 100 && Number.isFinite(elapsedMs)
      ? (elapsedMs * (100 - pct)) / pct
      : null;
  const avgBatchMs =
    batchesCompleted > 0 && Number.isFinite(elapsedMs)
      ? elapsedMs / batchesCompleted
      : null;

  const stageLabel = job?.currentStage
    ? STAGE_LABELS[job.currentStage] ?? job.currentStage
    : null;

  // Announce status and stage transitions only. A percentage ticking on every
  // poll would flood a live region; the progressbar exposes the value instead.
  const announcement = launchError
    ? "Unable to start scan."
    : resuming
      ? "Resuming existing scan."
      : {
          PENDING: "Scan queued. Waiting for the first batch.",
          RUNNING: `Scanning in progress${stageLabel ? `, stage: ${stageLabel}` : ""}.`,
          SUCCESS: "Scan complete.",
          FAILED: "Scan failed.",
        }[status ?? "PENDING"] ?? "Scan in progress.";

  const metrics: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Instruments", value: `${processed}/${total > 0 ? total : "—"} this stage` },
    {
      label: "Batches",
      value: `${batchesCompleted} done${
        (batches?.failed ?? 0) > 0 ? ` · ${batches?.failed} failed` : ""
      }`,
    },
  ];
  if ((job?.retryCount ?? 0) > 0) {
    metrics.push({ label: "Retries", value: String(job?.retryCount), tone: retryText });
  }
  metrics.push({ label: "Elapsed", value: formatDuration(elapsedMs) });
  if (avgBatchMs != null) {
    metrics.push({ label: "Avg batch", value: formatDuration(avgBatchMs) });
  }
  if (etaMs != null) {
    metrics.push({ label: "Est. remaining", value: `~${formatDuration(etaMs)}` });
  }

  const showMetrics = status === "RUNNING";
  const liveRegion = (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );

  if (layout === "wide") {
    const cardStyle = light
      ? {
          borderColor: "var(--ds-border)",
          background: "var(--ds-surface)",
          boxShadow: "var(--ds-shadow-card)",
        }
      : { borderColor: "rgb(51 65 85 / 0.6)", background: "rgb(15 23 42 / 0.6)" };
    const tileStyle = light
      ? { borderColor: "var(--ds-border)", background: "var(--ds-surface-subtle)" }
      : { borderColor: "rgb(51 65 85 / 0.6)", background: "rgb(30 41 59 / 0.5)" };

    return (
      <section
        aria-label="Scan progress"
        className="animate-in fade-in slide-in-from-top-1 overflow-hidden rounded-2xl border duration-300"
        style={cardStyle}
      >
        {liveRegion}
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <p
              className={cn(
                "text-[10.5px] font-semibold uppercase tracking-[0.12em]",
                muted
              )}
            >
              Scan status
            </p>
            <p
              className={cn(
                "mt-0.5 text-[14.5px] font-semibold leading-snug",
                launchError ? errorText : statusColor
              )}
            >
              {statusLabel}
            </p>
            {stageLabel && (status === "RUNNING" || status === "SUCCESS") && (
              <p className={cn("mt-0.5 truncate text-[12px]", secondary)}>{stageLabel}</p>
            )}
          </div>
          <span
            aria-hidden="true"
            className={cn(
              "ds-mono text-[24px] font-semibold leading-none tracking-tight tabular-nums",
              light ? "text-[var(--ds-text)]" : "text-slate-100"
            )}
          >
            {status === "PENDING" ? "…" : `${pct}%`}
          </span>
        </div>

        <div className="px-4 pb-4 sm:px-5">
          <div
            role="progressbar"
            aria-label="Scan progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status === "PENDING" ? undefined : pct}
            aria-valuetext={statusLabel}
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ background: light ? "var(--ds-surface-subtle)" : "rgb(51 65 85 / 0.6)" }}
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                barColor,
                status === "RUNNING" && "scanner-progress-shimmer"
              )}
              style={{ width: `${status === "PENDING" ? 4 : pct}%` }}
            />
          </div>

          {job?.errorMessage && (
            <p role="alert" className={cn("mt-2 text-[12px] leading-relaxed", errorText)}>
              {job.errorMessage}
            </p>
          )}

          {status === "PENDING" && (
            <p className={cn("mt-2 text-[11.5px]", muted)}>
              Waiting for the server to pick up the queued job.
            </p>
          )}

          {showMetrics && (
            <>
              <div className="mt-3 flex items-center justify-between gap-2 md:hidden">
                <button
                  type="button"
                  onClick={() => setMetricsOpen((value) => !value)}
                  aria-expanded={metricsOpen}
                  aria-controls="scan-progress-details"
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors",
                    light
                      ? "border-[var(--ds-border)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-subtle)]"
                      : "border-slate-700 text-slate-300 hover:bg-slate-800"
                  )}
                >
                  {metricsOpen ? "Hide details" : "Show details"}
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      metricsOpen && "rotate-180"
                    )}
                    aria-hidden="true"
                  />
                </button>
                <span className={cn("ds-mono text-[10.5px]", muted)}>
                  {formatDuration(elapsedMs)} elapsed
                </span>
              </div>

              <div
                id="scan-progress-details"
                className={cn(
                  "mt-3 grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6",
                  metricsOpen ? "grid" : "hidden md:grid"
                )}
              >
                {metrics.map((metric) => (
                  <div key={metric.label} className="rounded-xl border px-3 py-2" style={tileStyle}>
                    <p
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-[0.1em]",
                        muted
                      )}
                    >
                      {metric.label}
                    </p>
                    <p
                      className={cn(
                        "ds-mono mt-0.5 text-[12.5px] font-semibold tabular-nums",
                        light ? "text-[var(--ds-text)]" : "text-slate-200",
                        metric.tone
                      )}
                    >
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <details
            className="mt-3 rounded-xl border px-3 py-2"
            style={{ borderColor: light ? "var(--ds-border)" : "rgb(51 65 85 / 0.6)" }}
          >
            <summary
              className={cn(
                "cursor-pointer select-none text-[11.5px] font-semibold",
                secondary
              )}
            >
              How scanning works
            </summary>
            <p className={cn("mt-2 text-[11.5px] leading-relaxed", muted)}>
              The scan runs in bounded batches and stores progress on the server.
              Refreshing or reopening the scanner resumes the same job
              automatically. Closing this tab pauses progress; reopening continues
              where it stopped (never a duplicate job).
            </p>
            {etaMs != null && (
              <p className={cn("mt-1.5 text-[10.5px]", faint)}>
                Estimate extrapolated from overall progress; actual time varies by
                stage.
              </p>
            )}
          </details>

          {status === "SUCCESS" && (
            <p
              className={cn(
                "mt-2 text-[11.5px]",
                light ? "text-[var(--ds-positive)]" : "text-emerald-400/70"
              )}
            >
              Zones updated — the results table refreshes automatically.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-300">
      {liveRegion}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${launchError ? errorText : statusColor}`}>
          {statusLabel}
        </span>
        {status === "RUNNING" && (
          <span className={`text-xs ${muted}`}>{pct}%</span>
        )}
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status === "PENDING" ? undefined : pct}
        aria-valuetext={statusLabel}
        className={`h-1.5 w-full overflow-hidden rounded-full ${light ? "" : "bg-slate-700/60"}`}
        style={{ background: light ? "var(--ds-surface-subtle)" : undefined }}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor} ${
            status === "RUNNING" ? "scanner-progress-shimmer" : ""
          }`}
          style={{ width: `${status === "PENDING" ? 4 : pct}%` }}
        />
      </div>

      {job?.errorMessage && (
        <p className={`text-xs leading-relaxed ${errorText}`}>{job.errorMessage}</p>
      )}

      {job?.currentStage && (status === "RUNNING" || status === "SUCCESS") && (
        <p className={`text-xs ${secondary}`}>
          {STAGE_LABELS[job.currentStage] ?? job.currentStage}
        </p>
      )}

      {status === "RUNNING" && (
        <div className={`grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums ${muted}`}>
          {metrics.map((metric) => (
            <Fragment key={metric.label}>
              <span>{metric.label}</span>
              <span className={cn("text-right", metric.tone ?? secondary)}>{metric.value}</span>
            </Fragment>
          ))}
        </div>
      )}

      {status === "RUNNING" && (
        <p className={`text-xs leading-relaxed ${muted}`}>
          This tab processes the scan in bounded batches and shows persisted
          progress. Refresh or reopen the scanner and the same job resumes
          automatically. Closing the tab pauses progress; reopening continues
          exactly where it stopped (never a duplicate job).
        </p>
      )}
      {etaMs != null && (
        <p className={`text-[10px] ${faint}`}>
          Estimate extrapolated from overall progress; actual time varies by stage.
        </p>
      )}

      {status === "SUCCESS" && (
        <p className={`text-xs ${light ? "text-[var(--ds-positive)]" : "text-emerald-400/70"}`}>
          Zones updated — the table below refreshes automatically.
        </p>
      )}
    </div>
  );
}
