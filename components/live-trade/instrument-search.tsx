"use client";

import { Database, Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LiveTradeItemDto } from "@/lib/live-trade/client";
import { liveTradeErrorMessage } from "@/lib/live-trade/client";
import {
  useInstrumentSearch,
  type InstrumentSearchResult,
} from "@/hooks/use-instrument-search";
import { formatDateOnly } from "@/lib/live-trade/ui";

interface InstrumentSearchProps {
  items: LiveTradeItemDto[];
  enabled: boolean;
  atLimit: boolean;
  activeGroupId: string | null;
  onAdd: (
    instrument: InstrumentSearchResult,
    groupId: string | null
  ) => Promise<void>;
}

export function InstrumentSearch({
  items,
  enabled,
  atLimit,
  activeGroupId,
  onAdd,
}: InstrumentSearchProps) {
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const { results, master, resultQuery, loading, error } = useInstrumentSearch(
    query,
    enabled
  );

  const entryCounts = new Map<number, number>();
  for (const item of items) {
    entryCounts.set(
      item.instrumentId,
      (entryCounts.get(item.instrumentId) ?? 0) + 1
    );
  }
  const trimmed = query.trim();
  const showEmpty =
    trimmed !== "" &&
    resultQuery === trimmed &&
    !loading &&
    error === null &&
    results.length === 0;

  async function handleAdd(instrument: InstrumentSearchResult) {
    setAddingId(instrument.instrumentId);
    setAddError(null);
    try {
      await onAdd(instrument, activeGroupId);
    } catch (cause) {
      setAddError(liveTradeErrorMessage(cause));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <section
      aria-labelledby="instrument-search-heading"
      className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-4 shadow-[var(--ds-shadow-card)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--ds-gold-50)] text-[var(--ds-gold-700)]">
              <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            </span>
            <h2
              id="instrument-search-heading"
              className="text-[13px] font-bold text-[var(--ds-text)]"
            >
              Add instruments
            </h2>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--ds-text-muted)]">
            Search active NSE symbols or company names. Selecting a symbol again adds a separate trade entry.
          </p>
        </div>
        <span className="ds-mono shrink-0 rounded-full border border-[var(--ds-border)] bg-[var(--ds-gold-50)] px-2 py-1 text-[9.5px] font-semibold text-[var(--ds-text-secondary)]">
          {items.length} / 200
        </span>
      </div>

      <div className="relative mt-3">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ds-text-muted)]">
          <Search className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <input
          id="live-trade-instrument-search"
          type="search"
          value={query}
          maxLength={50}
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. INFY or Infosys"
          aria-label="Search NSE instruments to add"
          onChange={(event) => {
            setQuery(event.target.value);
            setAddError(null);
          }}
          className="min-h-11 w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] py-2 pl-9 pr-9 text-sm text-[var(--ds-text)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-500)]/40"
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear instrument search"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-[var(--ds-text-muted)] hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {atLimit && (
        <p className="mt-2 rounded-lg border border-[var(--ds-gold-300)] bg-[var(--ds-warning-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--ds-warning)]">
          Your board has reached the 200 trade-entry limit. Remove a trade
          entry before adding another.
        </p>
      )}

      {addError && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-[var(--ds-negative)]/25 bg-[var(--ds-negative-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--ds-negative)]"
        >
          {addError}
        </p>
      )}

      {loading && (
        <div className="mt-3 space-y-1.5" aria-label="Searching instruments">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-12 animate-pulse rounded-lg bg-[var(--ds-surface-subtle)]"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="mt-3 text-xs text-[var(--ds-negative)]">
          {liveTradeErrorMessage(error)}
        </p>
      )}

      {!loading && !error && results.length > 0 && (
        <ul
          className="mt-3 max-h-72 divide-y divide-[var(--ds-border)] overflow-y-auto rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)]"
          aria-label="Instrument search results"
        >
          {results.map((instrument) => {
            const entryCount =
              entryCounts.get(instrument.instrumentId) ?? 0;
            const adding = addingId === instrument.instrumentId;
            return (
              <li
                key={instrument.instrumentId}
                className="flex items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-[var(--ds-gold-50)]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="ds-mono text-xs font-bold text-[var(--ds-text)]">
                      {instrument.symbol}
                    </span>
                    <Badge
                      variant="neutral"
                      className="border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-1.5 py-0 text-[9px] text-[var(--ds-text-secondary)]"
                    >
                      {instrument.exchange}
                    </Badge>
                    {entryCount > 0 && (
                      <Badge
                        variant="neutral"
                        className="border-[var(--ds-gold-300)] bg-[var(--ds-gold-50)] px-1.5 py-0 text-[9px] text-[var(--ds-gold-700)]"
                      >
                        {entryCount === 1
                          ? "1 entry on board"
                          : `${entryCount} entries on board`}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[10.5px] text-[var(--ds-text-muted)]">
                    {instrument.name ?? "Company name unavailable"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={adding}
                  disabled={atLimit || addingId !== null}
                  onClick={() => void handleAdd(instrument)}
                  className="min-h-11 shrink-0 gap-1 border-[var(--ds-border-strong)] bg-[var(--ds-gold-50)] px-2.5 text-[var(--ds-text)] hover:bg-[var(--ds-gold-100)] focus-visible:ring-[var(--ds-gold-700)] focus-visible:ring-offset-[var(--ds-surface)]"
                  aria-label={
                    entryCount > 0
                      ? `Add another ${instrument.symbol} trade entry`
                      : `Add ${instrument.symbol} to watchlist`
                  }
                >
                  {entryCount > 0 ? "Add trade" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {showEmpty && (
        <p className="mt-3 rounded-lg border border-dashed border-[var(--ds-border)] bg-[var(--ds-gold-50)]/50 px-3 py-4 text-center text-xs leading-relaxed text-[var(--ds-text-muted)]">
          No active NSE instruments match “{trimmed}”.
        </p>
      )}

      {master && (
        <p className="mt-3 flex items-start gap-1.5 border-t border-[var(--ds-border)] pt-3 text-[9.5px] leading-relaxed text-[var(--ds-text-muted)]">
          <Database className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            Instrument list last updated {formatDateOnly(master.latestInstrumentUpdateAt)} ·{" "}
            {master.activeInstrumentCount.toLocaleString("en-IN")} active instruments · freshness unknown
          </span>
        </p>
      )}
    </section>
  );
}
