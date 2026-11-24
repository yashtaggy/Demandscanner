"use client";

import { memo } from "react";
import { ChevronDown, ChevronUp, Layers3, Pencil, Trash2 } from "lucide-react";
import type {
  LiveTradeGroupDto,
  LiveTradeItemDto,
  LiveTradeQuoteDto,
  LiveTradeZoneSummaryDto,
} from "@/lib/live-trade/client";
import type { QuoteDisplayState } from "@/hooks/use-live-trade-quotes";
import {
  PRIORITY_META,
  STATUS_LABEL,
  directionLabel,
  formatDateTimeIst,
  formatPrice,
} from "@/lib/live-trade/ui";
import { cn } from "@/lib/utils";
import { QuoteDisplay } from "./quote-display";
import { ZoneSummary } from "./zone-summary";

interface WatchlistRowProps {
  item: LiveTradeItemDto;
  /**
   * 1-based position among this instrument's entries, or null when the
   * instrument has a single entry and the number would only add noise.
   */
  entryNumber: number | null;
  groupName: string | null;
  summary: LiveTradeZoneSummaryDto | undefined;
  quote: LiveTradeQuoteDto | undefined;
  quoteDisplayState: QuoteDisplayState;
  zonesAvailable: boolean;
  zonesLoading: boolean;
  zonesError: boolean;
  quoteLoading: boolean;
  groups: LiveTradeGroupDto[];
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onExpandZones: () => void;
  onMoveGroup: (groupId: string | null) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-30",
        tone === "danger"
          ? "border-[var(--ds-negative)]/20 bg-[var(--ds-negative-soft)] text-[var(--ds-negative)] hover:bg-[var(--ds-negative)]/10"
          : "border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-muted)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]"
      )}
    >
      {children}
    </button>
  );
}

function PlanValue({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--ds-text-muted)]">
        {label}
      </p>
      <p
        className={cn(
          "ds-mono mt-1 text-[12px] font-semibold",
          value === null ? "text-[10px] font-normal text-[var(--ds-text-muted)]" : "text-[var(--ds-text)]"
        )}
      >
        {value === null ? "Not set" : formatPrice(value)}
      </p>
    </div>
  );
}

function WatchlistRowComponent({
  item,
  entryNumber,
  groupName,
  summary,
  quote,
  quoteDisplayState,
  zonesAvailable,
  zonesLoading,
  zonesError,
  quoteLoading,
  groups,
  busy,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onExpandZones,
  onMoveGroup,
  onMoveUp,
  onMoveDown,
}: WatchlistRowProps) {
  const priority = PRIORITY_META[item.priority];
  const entryLabel =
    entryNumber === null ? item.symbol : `${item.symbol} entry ${entryNumber}`;

  return (
    <article
      aria-label={`${entryLabel} watchlist item`}
      aria-busy={busy}
      data-testid={`watchlist-item-${item.itemId}`}
      data-symbol={item.symbol}
      className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] shadow-[var(--ds-shadow-card)] transition-colors hover:border-[var(--ds-border-strong)]"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ds-mono text-[16px] font-bold tracking-tight text-[var(--ds-text)]">
                {item.symbol}
              </span>
              {entryNumber !== null && (
                <span
                  className="rounded-md border border-[var(--ds-gold-300)] bg-[var(--ds-gold-50)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ds-gold-700)]"
                  title={`Entry ${entryNumber} for ${item.symbol}`}
                >
                  #{entryNumber}
                </span>
              )}
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[9.5px] font-bold",
                  priority.className
                )}
              >
                {priority.label}
              </span>
              {item.direction && (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[9.5px] font-bold",
                    item.direction === "BUY"
                      ? "border-[var(--ds-positive)]/25 bg-[var(--ds-positive-soft)] text-[var(--ds-positive)]"
                      : "border-[var(--ds-negative)]/25 bg-[var(--ds-negative-soft)] text-[var(--ds-negative)]"
                  )}
                >
                  {directionLabel(item.direction)}
                </span>
              )}
              <span className="ds-mono rounded-md border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--ds-text-secondary)]">
                {item.timeframe ?? "Any TF"}
              </span>
              <span className="text-[10px] font-medium text-[var(--ds-text-muted)]">
                {STATUS_LABEL[item.tradeStatus]}
              </span>
              {busy && <span className="ds-lt-spinner text-[var(--ds-gold-700)]" role="status" aria-label="Updating trade entry" />}
            </div>

            <p className="truncate text-xs text-[var(--ds-text-secondary)]" title={item.companyName ?? undefined}>
              {item.companyName ?? "Company name unavailable"}
            </p>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="ds-mono text-[9.5px] text-[var(--ds-text-muted)]">
                Added {formatDateTimeIst(item.createdAt)}
              </p>
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ds-text-muted)]">
                Group
                <select
                  value={item.groupId ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    onMoveGroup(event.target.value === "" ? null : event.target.value)
                  }
                  aria-label={`Move ${entryLabel} to another group`}
                  className="min-h-11 max-w-[180px] rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2 py-1 text-[10px] font-medium text-[var(--ds-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-500)]/40 disabled:opacity-50"
                >
                  <option value="">Ungrouped</option>
                  {groups.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.name}
                    </option>
                  ))}
                </select>
                {groupName && (
                  <span className="font-normal text-[var(--ds-text-muted)]">· {groupName}</span>
                )}
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <IconButton
              label={`Move ${entryLabel} up`}
              onClick={onMoveUp}
              disabled={busy || !canMoveUp}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Move ${entryLabel} down`}
              onClick={onMoveDown}
              disabled={busy || !canMoveDown}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <button
              type="button"
              onClick={onExpandZones}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-3 text-[11px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]"
            >
              <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
              Zones
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--ds-gold-300)] bg-[var(--ds-gold-50)] px-3 text-[11px] font-bold text-[var(--ds-gold-700)] transition-colors hover:bg-[var(--ds-gold-100)]"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
            <IconButton
              label={`Remove ${entryLabel} from watchlist`}
              onClick={onDelete}
              tone="danger"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="ds-lt-row-grid border-t border-[var(--ds-border)] pt-4">
          <section aria-label="Trade plan" className="space-y-2.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--ds-text-muted)]">
              Trade plan
            </p>
            <div className="grid grid-cols-3 gap-2">
              <PlanValue label="Entry" value={item.entryPrice} />
              <PlanValue label="Target" value={item.targetPrice} />
              <PlanValue label="Stop" value={item.stopLoss} />
            </div>
            <p className="text-[9.5px] leading-relaxed text-[var(--ds-text-muted)]">
              Planned levels only — not an order or a recommendation.
            </p>
          </section>

          <section aria-label="Latest quote" className="space-y-2.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--ds-text-muted)]">
              Latest quote
            </p>
            <QuoteDisplay
              quote={quote}
              displayState={quoteDisplayState}
              loading={quoteLoading}
              compact
            />
          </section>

          <section aria-label="Demand and supply zones" className="ds-lt-row-zone">
            <ZoneSummary
              summary={summary}
              quote={quote}
              zonesAvailable={zonesAvailable}
              displayState={quoteDisplayState}
              zonesLoading={zonesLoading}
              zonesError={zonesError}
            />
          </section>
        </div>

        {item.notes.trim() !== "" && (
          <details className="border-t border-[var(--ds-border)] pt-2">
            <summary className="flex min-h-11 cursor-pointer select-none items-center text-[11px] font-semibold text-[var(--ds-text-secondary)] hover:text-[var(--ds-text)]">
              Notes
            </summary>
            <p className="mb-1 whitespace-pre-wrap rounded-lg bg-[var(--ds-gold-50)]/60 px-3 py-2.5 text-xs leading-relaxed text-[var(--ds-text-secondary)]">
              {item.notes}
            </p>
          </details>
        )}
      </div>
    </article>
  );
}

/**
 * A row re-renders only when its own data changes. Callback identities are
 * ignored because Watchlist recreates them per render: the reorder handlers
 * go through a latest-handler ref, and every other handler acts on the item
 * id against the board state at execution time, so a memoised row can never
 * invoke an obsolete handler.
 */
function sameRowProps(
  previous: WatchlistRowProps,
  next: WatchlistRowProps
): boolean {
  return (
    previous.item === next.item &&
    previous.entryNumber === next.entryNumber &&
    previous.groupName === next.groupName &&
    previous.summary === next.summary &&
    previous.quote === next.quote &&
    previous.quoteDisplayState === next.quoteDisplayState &&
    previous.zonesAvailable === next.zonesAvailable &&
    previous.zonesLoading === next.zonesLoading &&
    previous.zonesError === next.zonesError &&
    previous.quoteLoading === next.quoteLoading &&
    previous.groups === next.groups &&
    previous.busy === next.busy &&
    previous.canMoveUp === next.canMoveUp &&
    previous.canMoveDown === next.canMoveDown
  );
}

export const WatchlistRow = memo(WatchlistRowComponent, sameRowProps);
