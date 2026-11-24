"use client";

import { useEffect, useRef } from "react";
import type {
  LiveTradeGroupDto,
  LiveTradeItemDto,
  LiveTradeQuoteDto,
  LiveTradeZoneSummaryDto,
} from "@/lib/live-trade/client";
import type { QuoteDisplayState } from "@/hooks/use-live-trade-quotes";
import { WatchlistRow } from "./watchlist-row";

interface WatchlistProps {
  items: LiveTradeItemDto[];
  /**
   * 1-based repeat-entry number per item id, computed over the full board so a
   * filter cannot renumber the rows. Items with a single instrument entry are
   * absent from the map.
   */
  entryNumbers: ReadonlyMap<string, number>;
  groups: LiveTradeGroupDto[];
  summaries: Map<number, LiveTradeZoneSummaryDto>;
  quotes: Record<number, LiveTradeQuoteDto>;
  quoteDisplayState: QuoteDisplayState;
  zonesAvailable: boolean;
  zonesLoading: boolean;
  zonesError: boolean;
  quoteLoading: boolean;
  busyItemIds: ReadonlySet<string>;
  onEdit: (item: LiveTradeItemDto) => void;
  onDelete: (item: LiveTradeItemDto) => void;
  onExpandZones: (item: LiveTradeItemDto) => void;
  onMoveGroup: (item: LiveTradeItemDto, groupId: string | null) => void;
  onReorder: (item: LiveTradeItemDto, direction: "up" | "down") => void;
}

export function Watchlist({
  items,
  entryNumbers,
  groups,
  summaries,
  quotes,
  quoteDisplayState,
  zonesAvailable,
  zonesLoading,
  zonesError,
  quoteLoading,
  busyItemIds,
  onEdit,
  onDelete,
  onExpandZones,
  onMoveGroup,
  onReorder,
}: WatchlistProps) {
  const groupNames = new Map(groups.map((group) => [group.groupId, group.name]));

  // Rows are memoised on data only, so a row can keep the reorder handlers
  // from an earlier render. Routing them through the latest handler means a
  // retained row still moves relative to the current list.
  const reorderRef = useRef(onReorder);
  useEffect(() => {
    reorderRef.current = onReorder;
  });

  return (
    <div className="ds-lt-watchlist space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--ds-gold-700)]">
            Saved order
          </p>
          <h2 className="mt-0.5 text-[15px] font-bold text-[var(--ds-text)]">Watchlist</h2>
        </div>
        <p className="text-[10px] text-[var(--ds-text-muted)]">
          Arrows reorder within the visible list. Every change is saved.
        </p>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <WatchlistRow
            key={item.itemId}
            item={item}
            entryNumber={entryNumbers.get(item.itemId) ?? null}
            groupName={
              item.groupId ? groupNames.get(item.groupId) ?? null : null
            }
            summary={summaries.get(item.instrumentId)}
            quote={quotes[item.instrumentId]}
            quoteDisplayState={quoteDisplayState}
            zonesAvailable={zonesAvailable}
            zonesLoading={zonesLoading}
            zonesError={zonesError}
            quoteLoading={quoteLoading}
            groups={groups}
            busy={busyItemIds.has(item.itemId)}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item)}
            onExpandZones={() => onExpandZones(item)}
            onMoveGroup={(groupId) => onMoveGroup(item, groupId)}
            onMoveUp={() => reorderRef.current(item, "up")}
            onMoveDown={() => reorderRef.current(item, "down")}
          />
        ))}
      </div>
    </div>
  );
}
