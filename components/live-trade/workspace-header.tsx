"use client";

import { ChartCandlestick, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { QuoteDisplayState } from "@/hooks/use-live-trade-quotes";
import { formatDateTimeIst, formatCount } from "@/lib/live-trade/ui";

export interface QuoteSummaryView {
  total: number;
  live: number;
  delayed: number;
  lastClose: number;
  unavailable: number;
}

interface WorkspaceHeaderProps {
  entryCount: number;
  groupCount: number;
  fetchedAt: string | null;
  quoteSummary: QuoteSummaryView;
  quotesLoading: boolean;
  quotesRefreshing: boolean;
  quoteError: string | null;
  displayState: QuoteDisplayState;
  cooldownSecondsLeft: number;
  onRefreshQuotes: () => void;
}

export function WorkspaceHeader({
  entryCount,
  groupCount,
  fetchedAt,
  quoteSummary,
  quotesLoading,
  quotesRefreshing,
  quoteError,
  displayState,
  cooldownSecondsLeft,
  onRefreshQuotes,
}: WorkspaceHeaderProps) {
  const refreshDisabled =
    quotesRefreshing ||
    quotesLoading ||
    cooldownSecondsLeft > 0 ||
    displayState === "sign-in" ||
    displayState === "broker";

  const refreshLabel = quotesRefreshing || quotesLoading
    ? "Refreshing…"
    : cooldownSecondsLeft > 0
      ? `Retry in ${cooldownSecondsLeft}s`
      : displayState === "sign-in"
        ? "Sign in to refresh"
        : displayState === "broker"
          ? "Connect Kite to refresh"
          : "Refresh quotes";

  const stateLabel =
    displayState === "stale"
      ? "Stale snapshot"
      : displayState === "sign-in"
        ? "Sign in required"
        : displayState === "broker"
          ? "Kite connection required"
          : null;

  return (
    <section
      aria-labelledby="live-trade-heading"
      className="overflow-hidden rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] shadow-[var(--ds-shadow-card)]"
    >
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ds-gold-300)] bg-[var(--ds-gold-50)] text-[var(--ds-gold-700)]">
              <ChartCandlestick className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--ds-gold-700)]">
                Personal workspace
              </p>
              <h1
                id="live-trade-heading"
                className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight text-[var(--ds-text)]"
              >
                Live Trade
              </h1>
            </div>
          </div>
          <p className="mt-3 max-w-xl text-[12.5px] leading-relaxed text-[var(--ds-text-secondary)]">
            A considered watchlist for market context, structural zones and your own trade plans.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ds-text-muted)]">
            <span className="ds-mono font-semibold text-[var(--ds-text)]">
              {formatCount(entryCount)} tracked trade {entryCount === 1 ? "entry" : "entries"}
            </span>
            <span className="h-3 w-px bg-[var(--ds-border)]" aria-hidden="true" />
            <span className="ds-mono font-semibold text-[var(--ds-text)]">
              {formatCount(groupCount)} {groupCount === 1 ? "group" : "groups"}
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRefreshQuotes}
          disabled={refreshDisabled || entryCount === 0}
          loading={quotesRefreshing || quotesLoading}
          id="refresh-quotes-btn"
          className="min-h-11 self-start border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-3.5 text-[var(--ds-text-secondary)] shadow-none hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] focus-visible:ring-[var(--ds-gold-700)] focus-visible:ring-offset-[var(--ds-surface)]"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {refreshLabel}
        </Button>
      </div>

      <div className="border-t border-[var(--ds-border)] bg-[var(--ds-gold-50)]/45 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--ds-text-muted)]">
                Quote freshness
              </p>
              {stateLabel && (
                <Badge
                  variant="warning"
                  className="border-[var(--ds-gold-300)] bg-[var(--ds-warning-soft)] px-2 py-0.5 text-[10px] text-[var(--ds-warning)]"
                >
                  {stateLabel}
                </Badge>
              )}
            </div>
            <p className="mt-1.5 text-xs tabular-nums text-[var(--ds-text-secondary)]">
              {quoteSummary.total === 0
                ? "Add an instrument to load quotes."
                : fetchedAt === null
                  ? quotesLoading
                    ? "Loading quotes…"
                    : "Quotes not loaded yet."
                  : `${displayState === "stale" ? "Last successful refresh" : "Updated"} ${formatDateTimeIst(fetchedAt)} IST`}
            </p>
            {quoteError && (
              <p role="status" className="mt-1.5 text-[11px] leading-relaxed text-[var(--ds-warning)]">
                {quoteError}
                {cooldownSecondsLeft > 0 ? ` Retry in ${cooldownSecondsLeft}s.` : ""}{" "}
                Your board data is unaffected.
              </p>
            )}
          </div>

          <dl className="grid grid-cols-4 divide-x divide-[var(--ds-border)] rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] py-2.5">
            {[
              { label: "Live", value: quoteSummary.live, tone: "var(--ds-positive)" },
              { label: "Delayed", value: quoteSummary.delayed, tone: "var(--ds-warning)" },
              { label: "Last close", value: quoteSummary.lastClose, tone: "var(--ds-info)" },
              { label: "Unavailable", value: quoteSummary.unavailable, tone: "var(--ds-text-muted)" },
            ].map((stat) => (
              <div key={stat.label} className="min-w-0 px-3 text-center sm:px-4">
                <dt className="truncate text-[9px] font-semibold uppercase tracking-wider text-[var(--ds-text-muted)]">
                  {stat.label}
                </dt>
                <dd className="ds-mono mt-1 text-base font-semibold" style={{ color: stat.tone }}>
                  {formatCount(stat.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-[var(--ds-text-muted)]">
          Market session, quote freshness and scanner coverage freshness are separate signals.
          Quotes refresh automatically every 30 seconds while this page is active.
        </p>
      </div>
    </section>
  );
}
