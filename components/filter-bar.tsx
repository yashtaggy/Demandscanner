"use client";

import { useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  filter: "all" | "positive" | "negative";
  onFilterChange: (v: "all" | "positive" | "negative") => void;
  minChange: number;
  onMinChangeChange: (v: number) => void;
  refreshInterval: number;
  onRefreshIntervalChange: (v: number) => void;
  onRefresh: () => void;
  loading: boolean;
}

const REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
];

export function FilterBar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  minChange,
  onMinChangeChange,
  refreshInterval,
  onRefreshIntervalChange,
  onRefresh,
  loading,
}: FilterBarProps) {
  const [minChangeInput, setMinChangeInput] = useState(minChange > 0 ? String(minChange) : "");

  const handleMinChangeBlur = () => {
    const n = parseFloat(minChangeInput);
    onMinChangeChange(isNaN(n) || n < 0 ? 0 : n);
  };

  const segmentBase =
    "inline-flex items-center gap-1 rounded-xl p-0.5";

  return (
    <div
      className="rounded-2xl border p-2.5 sm:p-3"
      style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative min-w-[170px] flex-1 lg:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-text-muted)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              id="search-input"
              type="text"
              aria-label="Search symbol or company name"
              placeholder="Search symbol or name…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value.toUpperCase())}
              className="h-10 w-full rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] pl-9 pr-8 text-sm text-[var(--ds-text)] placeholder:text-[var(--ds-text-muted)] transition-colors focus:border-[var(--ds-gold-500)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-100)]"
            />
            {search && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)]"
                id="clear-search-button"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Direction filter */}
          <div
            className={cn(segmentBase, "border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] text-[13px]")}
            role="group"
            aria-label="Filter by direction"
          >
            {(["all", "positive", "negative"] as const).map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  id={`filter-${f}`}
                  onClick={() => onFilterChange(f)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-[10px] px-2.5 py-1.5 font-medium transition-colors sm:px-3",
                    active
                      ? f === "positive"
                        ? "bg-[var(--ds-positive-soft)] text-[var(--ds-positive)] shadow-sm"
                        : f === "negative"
                        ? "bg-[var(--ds-negative-soft)] text-[var(--ds-negative)] shadow-sm"
                        : "bg-[var(--ds-surface-elevated)] text-[var(--ds-text)] shadow-sm"
                      : "text-[var(--ds-text-secondary)] hover:text-[var(--ds-text)]"
                  )}
                >
                  {f === "all" ? "All" : f === "positive" ? "↑ Gainers" : "↓ Losers"}
                </button>
              );
            })}
          </div>

          {/* Min % change */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="min-change-input" className="shrink-0 text-[12px] font-medium text-[var(--ds-text-secondary)]">
              Min %
            </label>
            <input
              id="min-change-input"
              type="number"
              min="0"
              step="0.5"
              inputMode="decimal"
              placeholder="0"
              value={minChangeInput}
              onChange={(e) => setMinChangeInput(e.target.value)}
              onBlur={handleMinChangeBlur}
              className="ds-mono h-10 w-[72px] rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2.5 text-sm text-[var(--ds-text)] placeholder:text-[var(--ds-text-muted)] transition-colors focus:border-[var(--ds-gold-500)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-100)]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Auto-refresh */}
          <div className="flex items-center gap-1.5">
            <span className="hidden text-[11px] font-medium uppercase tracking-wide text-[var(--ds-text-muted)] sm:inline">
              Auto
            </span>
            <div
              className={cn(segmentBase, "border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] text-[11px] font-medium")}
              role="group"
              aria-label="Auto-refresh interval"
            >
              {REFRESH_OPTIONS.map((opt) => {
                const active = refreshInterval === opt.value;
                return (
                  <button
                    key={opt.value}
                    id={`refresh-${opt.label.toLowerCase()}`}
                    onClick={() => onRefreshIntervalChange(opt.value)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-[9px] px-2 py-1.5 transition-colors sm:px-2.5",
                      active
                        ? "bg-[var(--ds-surface-elevated)] text-[var(--ds-text)] shadow-sm"
                        : "text-[var(--ds-text-secondary)] hover:text-[var(--ds-text)]"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Manual refresh */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            id="manual-refresh-button"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-transparent bg-[var(--ds-text)] px-3.5 text-[13px] font-semibold text-[var(--ds-surface)] shadow-sm transition-colors hover:bg-[#3a372e] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} strokeWidth={2.25} />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
