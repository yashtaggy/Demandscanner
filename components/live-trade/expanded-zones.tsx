"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  LiveTradeExpandedZoneDto,
  LiveTradeItemDto,
  LiveTradeZoneSummaryDto,
} from "@/lib/live-trade/client";
import { liveTradeErrorMessage } from "@/lib/live-trade/client";
import { useExpandedZones } from "@/hooks/use-expanded-zones";
import {
  COVERAGE_META,
  LIFECYCLE_CLASS,
  LIFECYCLE_LABEL,
  SIDE_META,
  formatDateOnly,
  formatPrice,
  scoreTextClass,
} from "@/lib/live-trade/ui";
import { formatCount } from "@/lib/live-trade/ui";
import { cn } from "@/lib/utils";
import { CoverageBadge } from "./coverage-badge";
import { Modal } from "./modal";

interface ExpandedZonesProps {
  item: LiveTradeItemDto;
  summary: LiveTradeZoneSummaryDto | undefined;
  /** The independent summary request is still in flight. */
  zonesLoading: boolean;
  /** The independent summary request failed. */
  zonesError: boolean;
  onRetryZones: () => void;
  onClose: () => void;
}

function ZoneRow({ zone }: { zone: LiveTradeExpandedZoneDto }) {
  const side = SIDE_META[zone.side];
  return (
    <li
      className="space-y-1.5 px-3 py-2.5"
      aria-label={`${side.label} zone ${zone.timeframe} ${zone.pattern}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", side.dot)} />
        <span className={cn("text-xs font-semibold", side.text)}>
          {side.label}
        </span>
        <span className="text-[11px] text-[var(--ds-text-secondary)]">
          {zone.timeframe} · {zone.pattern}
        </span>
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px]",
            LIFECYCLE_CLASS[zone.lifecycleState]
          )}
        >
          {LIFECYCLE_LABEL[zone.lifecycleState]}
        </span>
        <span
          className={cn(
            "text-[11px] tabular-nums",
            scoreTextClass(zone.formationScore)
          )}
        >
          Formation {zone.formationScore}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--ds-text-muted)]">
            Zone
          </p>
          <p className="tabular-nums text-[var(--ds-text)]">
            {formatPrice(zone.zoneLow)} – {formatPrice(zone.zoneHigh)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--ds-text-muted)]">
            Proximal / distal
          </p>
          <p className="tabular-nums text-[var(--ds-text-secondary)]">
            {formatPrice(zone.proximal)} / {formatPrice(zone.distal)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--ds-text-muted)]">
            Formed
          </p>
          <p className="text-[var(--ds-text-secondary)]">{formatDateOnly(zone.formationTs)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--ds-text-muted)]">
            Touches
          </p>
          <p className="text-[var(--ds-text-secondary)]">
            {zone.touchCount}
            {zone.lastTouchTs
              ? ` · last ${formatDateOnly(zone.lastTouchTs)}`
              : ""}
          </p>
        </div>
      </div>
    </li>
  );
}

export function ExpandedZones({
  item,
  summary,
  zonesLoading,
  zonesError,
  onRetryZones,
  onClose,
}: ExpandedZonesProps) {
  const { zones, pagination, loading, loadingMore, error, loadMore, retry } =
    useExpandedZones(item.instrumentId, true);

  // A missing summary while the request is pending or failed is unknown, not
  // a confirmed UNKNOWN coverage, so it must never render as one.
  const coverageLoading = summary === undefined && zonesLoading;
  const coverageError = summary === undefined && zonesError;
  const coverage = summary?.coverage;
  const coverageMeta = coverage ? COVERAGE_META[coverage] : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${item.symbol} · structural zones`}
      description="All saved scanner zones for this instrument, including broken zones and any formation score. No quote is used, so price distance is not shown."
      size="xl"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] text-[var(--ds-text-muted)]">
            {pagination
              ? `Page ${pagination.page} · ${formatCount(zones.length)} shown`
              : "No zones loaded"}
            {pagination && pagination.hasMore ? " · more available" : ""}
          </p>
          <div className="flex justify-end gap-2">
            {pagination?.hasMore && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="ds-lt-button-secondary"
                loading={loadingMore}
                disabled={loading || loadingMore}
                onClick={loadMore}
              >
                Load more
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="ds-lt-button-ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {coverageError ? (
              <>
                <span className="rounded-full border border-[var(--ds-warning)]/25 bg-[var(--ds-warning-soft)] px-1.5 py-0.5 text-[10px] text-[var(--ds-warning)]">
                  Coverage unavailable
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ds-lt-button-ghost"
                  loading={zonesLoading}
                  onClick={onRetryZones}
                >
                  Retry coverage
                </Button>
              </>
            ) : coverageLoading ? (
              <span role="status" className="text-[11px] text-[var(--ds-text-muted)]">
                Loading zone coverage…
              </span>
            ) : coverage ? (
              <CoverageBadge coverage={coverage} />
            ) : (
              <span className="rounded-full border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--ds-text-secondary)]">
                Coverage not loaded
              </span>
            )}
            {summary?.preferredTimeframe && (
              <Badge
                variant="neutral"
                className="border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] text-[10px] text-[var(--ds-text-secondary)]"
              >
                Preferred {summary.preferredTimeframe}
              </Badge>
            )}
          </div>
          {coverageMeta ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--ds-text-muted)]">
              {coverageMeta.description}
            </p>
          ) : coverageError ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--ds-warning)]">
              Zone coverage could not be loaded. Saved zones below are still
              shown.
            </p>
          ) : null}
          {summary?.zoneFreshness.latestCoveringScanAt && (
            <p className="mt-0.5 text-[10px] text-[var(--ds-text-muted)]">
              Latest covering scan{" "}
              {formatDateOnly(summary.zoneFreshness.latestCoveringScanAt)} ·{" "}
              {summary.zoneFreshness.freshnessThresholdDays}-day freshness
              window · each zone keeps its own formation date.
            </p>
          )}
        </div>

        {loading && zones.length === 0 && (
          <div className="space-y-1.5" aria-label="Loading structural zones">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-16 animate-pulse rounded-lg bg-[var(--ds-surface-subtle)]"
              />
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ds-negative)]/25 bg-[var(--ds-negative-soft)] px-3 py-2">
            <p className="text-xs text-[var(--ds-negative)]">{liveTradeErrorMessage(error)}</p>
            <Button type="button" variant="ghost" size="sm" className="ds-lt-button-ghost" onClick={retry}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && zones.length === 0 && (
          <p className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-3 py-6 text-center text-xs text-[var(--ds-text-muted)]">
            {coverage === "NO_SCAN_HISTORY"
              ? "No completed scan covering this instrument was found."
              : coverage === "NO_ZONES"
                ? "The latest completed scan found no qualifying zones."
                : "No structural zones are saved for this instrument."}
          </p>
        )}

        {zones.length > 0 && (
          <ul className="divide-y divide-[var(--ds-border)] overflow-hidden rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)]">
            {zones.map((zone) => (
              <ZoneRow key={zone.zoneId} zone={zone} />
            ))}
          </ul>
        )}

        {pagination && !pagination.hasMore && zones.length > 0 && (
          <p className="text-center text-[10px] text-[var(--ds-text-muted)]">
            All available zones for this batch are shown. The retrieval limit is{" "}
            {formatCount(pagination.batchLimit)} zones.
          </p>
        )}
      </div>
    </Modal>
  );
}
