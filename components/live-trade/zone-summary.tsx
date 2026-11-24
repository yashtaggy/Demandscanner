"use client";

import type {
  LiveTradeNearestZoneDto,
  LiveTradeQuoteDto,
  LiveTradeZoneSummaryDto,
} from "@/lib/live-trade/client";
import type { ZoneSide } from "@/lib/scanner/types";
import type { QuoteDisplayState } from "@/hooks/use-live-trade-quotes";
import { CoverageBadge } from "./coverage-badge";
import {
  LIFECYCLE_CLASS,
  LIFECYCLE_LABEL,
  SIDE_META,
  TIMEFRAME_MATCH_LABEL,
  formatDateOnly,
  formatDistance,
  formatPrice,
  scoreTextClass,
} from "@/lib/live-trade/ui";
import { cn } from "@/lib/utils";

interface ZoneSummaryProps {
  summary: LiveTradeZoneSummaryDto | undefined;
  quote: LiveTradeQuoteDto | null | undefined;
  zonesAvailable: boolean;
  displayState: QuoteDisplayState;
  /** The summary request is still in flight and no summary exists yet. */
  zonesLoading?: boolean;
  /** The summary request failed; prices and plans are unaffected. */
  zonesError?: boolean;
}

function StructuralZone({
  zone,
  side,
}: {
  zone: LiveTradeNearestZoneDto | null;
  side: ZoneSide;
}) {
  const sideMeta = SIDE_META[side];

  if (!zone) {
    return (
      <div className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2.5 py-2 text-[11px] text-[var(--ds-text-muted)]">
        No structural {sideMeta.label.toLowerCase()} zone.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-[var(--ds-surface-elevated)] px-2.5 py-2",
        sideMeta.border
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", sideMeta.dot)} />
          <span className={cn("text-[11px] font-semibold", sideMeta.text)}>
            {sideMeta.label}
          </span>
          <span className="text-[11px] text-[var(--ds-text-secondary)]">
            {zone.timeframe} · {zone.pattern}
          </span>
          <span className="text-[10px] text-[var(--ds-text-muted)]">
            {TIMEFRAME_MATCH_LABEL[zone.timeframeMatch]}
          </span>
        </div>
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px]",
            LIFECYCLE_CLASS[zone.lifecycleState]
          )}
        >
          {LIFECYCLE_LABEL[zone.lifecycleState]}
        </span>
      </div>

      <p className="mt-1 text-[11px] tabular-nums text-[var(--ds-text)]">
        {formatPrice(zone.zoneLow)} – {formatPrice(zone.zoneHigh)}
        <span className={cn("ml-1.5", scoreTextClass(zone.formationScore))}>
          Formation {zone.formationScore}
        </span>
      </p>
      <p className="text-[10px] tabular-nums text-[var(--ds-text-muted)]">
        Proximal {formatPrice(zone.proximal)} · Distal {formatPrice(zone.distal)}
      </p>
      <p className="text-[10px] text-[var(--ds-text-muted)]">
        Formed {formatDateOnly(zone.formationTs)}
        {zone.touchCount > 0 ? ` · ${zone.touchCount}× touched` : ""}
      </p>
    </div>
  );
}

function QuoteDistance({
  label,
  zone,
}: {
  label: string;
  zone: LiveTradeNearestZoneDto | null;
}) {
  if (!zone || zone.distancePercent === null) {
    return (
      <p className="text-[10px] text-[var(--ds-text-muted)]">
        {label}: no price-eligible zone for this quote.
      </p>
    );
  }
  return (
    <p className="text-[10px] tabular-nums text-[var(--ds-text-secondary)]">
      {label}:{" "}
      <span className="text-[var(--ds-text)]">{formatDistance(zone.distancePercent)}</span>{" "}
      from LTP · proximal {formatPrice(zone.proximal)} · {zone.timeframe}
    </p>
  );
}

/**
 * Structural scanner zones (from the board) are rendered separately from
 * price-relative distances (from the latest valid quote). Distances are hidden
 * for retained, stale, invalid or unavailable quotes.
 */
export function ZoneSummary({
  summary,
  quote,
  zonesAvailable,
  displayState,
  zonesLoading = false,
  zonesError = false,
}: ZoneSummaryProps) {
  const coverage = summary?.coverage ?? "UNKNOWN";
  const freshness = summary?.zoneFreshness;
  const structuralLoading = summary === undefined && zonesLoading;
  const structuralError = summary === undefined && zonesError;

  const hasCurrentQuote =
    displayState === "current" &&
    quote !== null &&
    quote !== undefined &&
    quote.freshness !== "UNAVAILABLE" &&
    quote.lastPrice !== null;
  const distancesSuppressed =
    displayState === "stale" || displayState === "sign-in";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[10px] uppercase tracking-wider text-[var(--ds-text-muted)]">
          Scanner structure
        </p>
        {structuralLoading ? (
          <span role="status" className="text-[10px] text-[var(--ds-text-muted)]">
            Loading zones…
          </span>
        ) : structuralError ? (
          <span className="rounded-full border border-[var(--ds-warning)]/25 bg-[var(--ds-warning-soft)] px-1.5 py-0.5 text-[10px] text-[var(--ds-warning)]">
            Zones unavailable
          </span>
        ) : (
          <CoverageBadge coverage={coverage} />
        )}
        {summary?.preferredTimeframe && (
          <span className="text-[10px] text-[var(--ds-text-muted)]">
            Preferred {summary.preferredTimeframe}
          </span>
        )}
      </div>

      {structuralLoading ? (
        <div
          className="grid gap-1.5"
          aria-busy="true"
          aria-label="Loading scanner zones"
        >
          <div className="h-16 animate-pulse rounded-lg bg-[var(--ds-surface-subtle)]" />
          <div className="h-16 animate-pulse rounded-lg bg-[var(--ds-surface-subtle)]" />
        </div>
      ) : (
        <>
          {structuralError ? (
            <p className="text-[10px] text-[var(--ds-warning)]">
              Scanner zones could not be loaded. Plans and prices are
              unaffected.
            </p>
          ) : (
            <p className="text-[10px] text-[var(--ds-text-muted)]">
              {freshness?.latestCoveringScanAt
                ? `Latest covering scan ${formatDateOnly(freshness.latestCoveringScanAt)}`
                : "No completed scan covering this instrument"}
              {freshness
                ? ` · ${freshness.zoneCount} zones (${freshness.activeZoneCount} active)`
                : ""}
            </p>
          )}

          <div className="grid gap-1.5">
            <StructuralZone
              zone={summary?.nearestDemand ?? null}
              side="DEMAND"
            />
            <StructuralZone
              zone={summary?.nearestSupply ?? null}
              side="SUPPLY"
            />
          </div>
        </>
      )}

      <div className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-2.5 py-1.5">
        <p className="text-[10px] uppercase tracking-wider text-[var(--ds-text-muted)]">
          Price-relative (latest quote)
        </p>
        {distancesSuppressed ? (
          <p className="mt-0.5 text-[10px] text-[var(--ds-warning)]">
            Distance hidden: the retained quote is not current.
          </p>
        ) : !hasCurrentQuote ? (
          <p className="mt-0.5 text-[10px] text-[var(--ds-text-muted)]">
            A valid quote is required to calculate distance.
          </p>
        ) : !zonesAvailable ? (
          <p className="mt-0.5 text-[10px] text-[var(--ds-warning)]">
            Nearest zones for the latest quote were unavailable. Structural
            zones above are unaffected.
          </p>
        ) : (
          <div className="mt-0.5 space-y-0.5">
            <QuoteDistance label="Demand" zone={quote?.nearestDemand ?? null} />
            <QuoteDistance label="Supply" zone={quote?.nearestSupply ?? null} />
            {quote?.freshness === "DELAYED" && (
              <p className="text-[10px] text-[var(--ds-warning)]">
                Based on a delayed quote timestamp.
              </p>
            )}
            {quote?.freshness === "LAST_CLOSE" && (
              <p className="text-[10px] text-[var(--ds-text-muted)]">
                Based on the last close; the market is closed.
              </p>
            )}
          </div>
        )}
      </div>

      {coverage !== "AVAILABLE" && !structuralLoading && !structuralError && (
        <p className="text-[10px] leading-relaxed text-[var(--ds-text-muted)]">
          {coverage === "STALE"
            ? `Scan data is older than the ${freshness?.freshnessThresholdDays ?? 7}-day freshness window.`
            : "Structural zones may be incomplete for this instrument."}
        </p>
      )}

      {summary?.nearestDemand === null &&
        summary?.nearestSupply === null &&
        quote?.nearestDemand === null &&
        quote?.nearestSupply === null && (
          <p className="text-[10px] text-[var(--ds-text-muted)]">
            No demand or supply zone currently qualifies.
          </p>
        )}

      {freshness && freshness.latestCoveringScanAt && (
        <p className="text-[10px] text-[var(--ds-text-muted)]">
          Scan freshness window {freshness.freshnessThresholdDays} days. Each
          zone keeps its own formation date.
        </p>
      )}
    </div>
  );
}
