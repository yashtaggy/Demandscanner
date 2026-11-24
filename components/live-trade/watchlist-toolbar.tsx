"use client";

import { Search, Tags, X } from "lucide-react";
import type { LiveTradeGroupDto } from "@/lib/live-trade/client";
import type { LiveTradePriority } from "@/lib/live-trade/constants";
import { PRIORITY_META } from "@/lib/live-trade/ui";

export type GroupFilter = "ALL" | "UNGROUPED" | string;
export type PriorityFilter = "ALL" | LiveTradePriority;

interface WatchlistToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  groupFilter: GroupFilter;
  onGroupFilterChange: (value: GroupFilter) => void;
  priorityFilter: PriorityFilter;
  onPriorityFilterChange: (value: PriorityFilter) => void;
  groups: LiveTradeGroupDto[];
  total: number;
  shown: number;
  onManageGroups: () => void;
  onClearFilters: () => void;
}

const selectClass =
  "min-h-11 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--ds-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-500)]/40";

export function WatchlistToolbar({
  search,
  onSearchChange,
  groupFilter,
  onGroupFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  groups,
  total,
  shown,
  onManageGroups,
  onClearFilters,
}: WatchlistToolbarProps) {
  const hasFilters =
    search.trim() !== "" || groupFilter !== "ALL" || priorityFilter !== "ALL";

  return (
    <div className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 shadow-[var(--ds-shadow-card)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ds-text-muted)]">
            <Search className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </span>
          <input
            id="live-trade-watchlist-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search watchlist"
            aria-label="Search watchlist by symbol, company or notes"
            className="min-h-11 w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] py-2 pl-9 pr-3 text-xs text-[var(--ds-text)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-500)]/40"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ds-text-muted)]">
            Group
            <select
              value={groupFilter}
              onChange={(event) =>
                onGroupFilterChange(event.target.value as GroupFilter)
              }
              aria-label="Filter watchlist by group"
              className={selectClass}
            >
              <option value="ALL">All groups</option>
              <option value="UNGROUPED">Ungrouped</option>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ds-text-muted)]">
            Priority
            <select
              value={priorityFilter}
              onChange={(event) =>
                onPriorityFilterChange(event.target.value as PriorityFilter)
              }
              aria-label="Filter watchlist by priority"
              className={selectClass}
            >
              <option value="ALL">All priorities</option>
              {(["HIGH", "MEDIUM", "LOW"] as const).map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_META[priority].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="ds-mono px-1 text-[10.5px] text-[var(--ds-text-muted)]">
            Showing {shown} of {total}
          </span>
          {hasFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-3 text-[11px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={onManageGroups}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--ds-border-strong)] bg-[var(--ds-gold-50)] px-3 text-[11px] font-bold text-[var(--ds-text)] transition-colors hover:bg-[var(--ds-gold-100)]"
          >
            <Tags className="h-3.5 w-3.5" aria-hidden="true" />
            Manage groups
          </button>
        </div>
      </div>
    </div>
  );
}
