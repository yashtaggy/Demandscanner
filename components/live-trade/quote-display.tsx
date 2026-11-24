"use client";

import { Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LiveTradeQuoteDto } from "@/lib/live-trade/client";
import type { LiveTradeQuoteErrorCode } from "@/lib/live-trade/constants";
import {
  QUOTE_ERROR_TEXT,
  QUOTE_FRESHNESS_META,
  formatDateTimeIst,
  formatPrice,
} from "@/lib/live-trade/ui";
import type { QuoteDisplayState } from "@/hooks/use-live-trade-quotes";
import { cn, formatPercent } from "@/lib/utils";

interface QuoteDisplayProps {
  quote: LiveTradeQuoteDto | null | undefined;
  displayState: QuoteDisplayState;
  loading?: boolean;
  compact?: boolean;
}

function changeClass(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value === 0) {
    return "text-[var(--ds-text-muted)]";
  }
  return value > 0 ? "text-[var(--ds-positive)]" : "text-[var(--ds-negative)]";
}

const FRESHNESS_CLASS = {
  success: "border-[var(--ds-positive)]/25 bg-[var(--ds-positive-soft)] text-[var(--ds-positive)]",
  warning: "border-[var(--ds-warning)]/25 bg-[var(--ds-warning-soft)] text-[var(--ds-warning)]",
  info: "border-[var(--ds-info)]/25 bg-[var(--ds-info-soft)] text-[var(--ds-info)]",
  danger: "border-[var(--ds-negative)]/25 bg-[var(--ds-negative-soft)] text-[var(--ds-negative)]",
  neutral: "border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]",
};

/**
 * Quote cell. An unavailable or stale quote is never replaced by another price
 * source and never labelled live; retained snapshots say exactly when they were
 * fetched.
 */
export function QuoteDisplay({
  quote,
  displayState,
  loading = false,
  compact = false,
}: QuoteDisplayProps) {
  if (!quote) {
    if (loading) {
      return (
        <div className="space-y-2" aria-label="Loading quote">
          <div className="h-6 w-28 animate-pulse rounded bg-[var(--ds-surface-subtle)]" />
          <div className="h-3 w-36 animate-pulse rounded bg-[var(--ds-surface-subtle)]" />
        </div>
      );
    }
    return (
      <p className="text-xs leading-relaxed text-[var(--ds-text-muted)]">
        No quote loaded for this instrument yet.
      </p>
    );
  }

  const effectiveFreshness =
    displayState === "stale"
      ? "STALE"
      : displayState === "sign-in"
        ? "SIGN_IN_REQUIRED"
        : quote.freshness;
  const meta = QUOTE_FRESHNESS_META[effectiveFreshness] ?? {
    label: effectiveFreshness,
    tone: "neutral" as const,
  };

  const unavailable =
    quote.freshness === "UNAVAILABLE" ||
    quote.lastPrice === null ||
    !Number.isFinite(quote.lastPrice);

  if (unavailable) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="ds-mono text-base font-semibold text-[var(--ds-text-muted)]">—</span>
          <Badge
            variant="neutral"
            className="border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-2 py-0.5 text-[9.5px] text-[var(--ds-text-secondary)]"
          >
            Unavailable
          </Badge>
        </div>
        {quote.errorCode && (
          <p className="text-[11px] leading-relaxed text-[var(--ds-text-muted)]">
            {QUOTE_ERROR_TEXT[quote.errorCode as LiveTradeQuoteErrorCode]}
          </p>
        )}
        <p className="ds-mono text-[9.5px] text-[var(--ds-text-muted)]">
          Fetched {formatDateTimeIst(quote.fetchedAt)} IST
        </p>
      </div>
    );
  }

  const showChange =
    quote.change !== null && quote.changePercent !== null;

  return (
    <div className={cn("space-y-1.5", compact && "space-y-1")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--ds-text-muted)]">
          LTP
        </span>
        <span className="ds-mono text-[17px] font-bold tracking-tight text-[var(--ds-text)]">
          {formatPrice(quote.lastPrice)}
        </span>
        {effectiveFreshness === "LIVE" && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ds-positive)]" aria-hidden="true" />
        )}
        <Badge
          variant={meta.tone}
          className={cn("px-2 py-0.5 text-[9px] font-bold", FRESHNESS_CLASS[meta.tone])}
        >
          {meta.label}
        </Badge>
      </div>

      {showChange ? (
        <p className={cn("ds-mono text-[11px] font-semibold", changeClass(quote.change))}>
          {quote.change !== null && quote.change > 0 ? "+" : ""}
          {quote.change?.toFixed(2)} ({formatPercent(quote.changePercent ?? 0)})
        </p>
      ) : (
        <p className="text-[11px] text-[var(--ds-text-muted)]">Change unavailable</p>
      )}

      <dl className="space-y-1 text-[10px] text-[var(--ds-text-muted)]">
        <div className="flex flex-wrap gap-x-1.5">
          <dt>Last traded</dt>
          <dd className="tabular-nums">
            {quote.lastTradedAt
              ? `${formatDateTimeIst(quote.lastTradedAt)} IST`
              : "Not provided"}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            Quote fetched
          </dt>
          <dd className="tabular-nums">
            {formatDateTimeIst(quote.fetchedAt)} IST
          </dd>
        </div>
      </dl>

      {displayState === "stale" && (
        <p className="rounded-lg border border-[var(--ds-gold-300)] bg-[var(--ds-warning-soft)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--ds-warning)]">
          Retained snapshot. The latest refresh failed, so this is not a live price.
        </p>
      )}
      {displayState === "sign-in" && (
        <p className="rounded-lg border border-[var(--ds-gold-300)] bg-[var(--ds-warning-soft)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--ds-warning)]">
          Session expired. Reconnect to refresh this quote.
        </p>
      )}
      {displayState === "current" && effectiveFreshness === "DELAYED" && (
        <p className="text-[10px] leading-relaxed text-[var(--ds-warning)]">
          The provider timestamp is older than five minutes.
        </p>
      )}
    </div>
  );
}
