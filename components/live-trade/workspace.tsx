"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartCandlestick, FolderPlus, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createGroup,
  createItem,
  deleteGroup,
  deleteItem,
  isLiveTradeClientError,
  liveTradeErrorMessage,
  LiveTradeClientError,
  reorderGroups,
  reorderItems,
  updateGroup,
  updateItem,
  type LiveTradeItemDto,
  type UpdateItemPayload,
} from "@/lib/live-trade/client";
import { LIVE_TRADE_ITEM_LIMIT } from "@/lib/live-trade/constants";
import { formatCount } from "@/lib/live-trade/ui";
import { useLiveTradeBoard } from "@/hooks/use-live-trade-board";
import { useLiveTradeQuotes } from "@/hooks/use-live-trade-quotes";
import { useLiveTradeZoneSummaries } from "@/hooks/use-live-trade-zone-summaries";
import type { InstrumentSearchResult } from "@/hooks/use-instrument-search";
import { InstrumentSearch } from "./instrument-search";
import { ItemEditor } from "./item-editor";
import { GroupManager } from "./group-manager";
import { ExpandedZones } from "./expanded-zones";
import { ConfirmDialog } from "./confirm-dialog";
import { CoverageGuide } from "./coverage-guide";
import { ToastViewport, useToasts } from "./toast";
import {
  WatchlistToolbar,
  type GroupFilter,
  type PriorityFilter,
} from "./watchlist-toolbar";
import { Watchlist } from "./watchlist";
import {
  WorkspaceHeader,
  type QuoteSummaryView,
} from "./workspace-header";

interface LiveTradeWorkspaceProps {
  /** null while the browser is still checking broker connectivity. */
  brokerConnected: boolean | null;
}

interface WatchlistFilters {
  search: string;
  groupFilter: GroupFilter;
  priorityFilter: PriorityFilter;
}

function matchesFilters(
  item: LiveTradeItemDto,
  filters: WatchlistFilters
): boolean {
  if (filters.groupFilter === "UNGROUPED" && item.groupId !== null) return false;
  if (
    filters.groupFilter !== "ALL" &&
    filters.groupFilter !== "UNGROUPED" &&
    item.groupId !== filters.groupFilter
  ) {
    return false;
  }
  if (
    filters.priorityFilter !== "ALL" &&
    item.priority !== filters.priorityFilter
  ) {
    return false;
  }
  const needle = filters.search.trim().toLowerCase();
  if (needle === "") return true;
  return (
    item.symbol.toLowerCase().includes(needle) ||
    (item.companyName ?? "").toLowerCase().includes(needle) ||
    item.notes.toLowerCase().includes(needle)
  );
}

/**
 * Resolves a move against the current row order so the submitted payload is
 * always the complete, up-to-date item set. Returns null when the row or its
 * visible neighbour no longer exists.
 */
function reorderPayloadFor(
  items: LiveTradeItemDto[],
  filters: WatchlistFilters,
  itemId: string,
  direction: "up" | "down"
): string[] | null {
  const visible = items.filter((item) => matchesFilters(item, filters));
  const visibleIndex = visible.findIndex((item) => item.itemId === itemId);
  if (visibleIndex < 0) return null;
  const neighbour = visible[visibleIndex + (direction === "up" ? -1 : 1)];
  if (!neighbour) return null;

  const orderedIds = items.map((item) => item.itemId);
  const from = orderedIds.indexOf(itemId);
  const to = orderedIds.indexOf(neighbour.itemId);
  if (from < 0 || to < 0) return null;
  orderedIds.splice(from, 1);
  orderedIds.splice(to, 0, itemId);
  return orderedIds;
}

function groupReorderPayloadFor(
  groups: { groupId: string }[],
  groupId: string,
  direction: "up" | "down"
): string[] | null {
  const orderedIds = groups.map((group) => group.groupId);
  const from = orderedIds.indexOf(groupId);
  if (from < 0) return null;
  const to = from + (direction === "up" ? -1 : 1);
  if (to < 0 || to >= orderedIds.length) return null;
  orderedIds.splice(from, 1);
  orderedIds.splice(to, 0, groupId);
  return orderedIds;
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading Live Trade workspace">
      <div className="h-44 animate-pulse rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)]" />
      <div className="h-20 animate-pulse rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)]" />
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-56 animate-pulse rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)]"
        />
      ))}
    </div>
  );
}

function ReconnectLink() {
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      className="min-h-11 border-[var(--ds-gold-500)] bg-[var(--ds-gold-300)] text-[var(--ds-text)] hover:bg-[var(--ds-gold-500)] focus-visible:ring-[var(--ds-gold-700)] focus-visible:ring-offset-[var(--ds-canvas)]"
      onClick={() => {
        window.location.assign(
          new URL("/api/kite/login", window.location.origin).toString()
        );
      }}
    >
      Connect Kite
    </Button>
  );
}

function SignInLink() {
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      className="min-h-11 border-[var(--ds-gold-500)] bg-[var(--ds-gold-300)] text-[var(--ds-text)] hover:bg-[var(--ds-gold-500)] focus-visible:ring-[var(--ds-gold-700)] focus-visible:ring-offset-[var(--ds-canvas)]"
      onClick={() => {
        window.location.assign(
          new URL("/login?next=%2Flive-trade", window.location.origin).toString()
        );
      }}
    >
      Sign in
    </Button>
  );
}

export function LiveTradeWorkspace({
  brokerConnected,
}: LiveTradeWorkspaceProps) {
  const { board, loading, refreshing, error, refetch, runBoardTask } =
    useLiveTradeBoard(true);
  const { toasts, push, dismiss } = useToasts();

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("ALL");
  const [priorityFilter, setPriorityFilter] =
    useState<PriorityFilter>("ALL");
  const [busyItemIds, setBusyItemIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);

  // Queued reorder tasks run after other board changes; they resolve the move
  // against the filters that are current when they execute.
  const filtersRef = useRef<WatchlistFilters>({
    search,
    groupFilter,
    priorityFilter,
  });
  useEffect(() => {
    filtersRef.current = { search, groupFilter, priorityFilter };
  }, [search, groupFilter, priorityFilter]);

  const markItemBusy = useCallback((itemId: string, busy: boolean) => {
    setBusyItemIds((previous) => {
      if (previous.has(itemId) === busy) return previous;
      const next = new Set(previous);
      if (busy) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  const items = useMemo(() => board?.items ?? [], [board]);
  const groups = board?.groups ?? [];

  const instrumentIds = useMemo(() => {
    // Repeated entries for one instrument share a quote and a zone summary, so
    // the market-data requests carry each instrument id only once.
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const item of items) {
      if (seen.has(item.instrumentId)) continue;
      seen.add(item.instrumentId);
      ids.push(item.instrumentId);
    }
    return ids;
  }, [items]);

  // Repeat entries are numbered per instrument in creation order. The number
  // is computed over the whole board, not the filtered list, so filtering
  // cannot relabel a row.
  const entryNumbers = useMemo(() => {
    const byInstrument = new Map<number, LiveTradeItemDto[]>();
    for (const item of items) {
      const list = byInstrument.get(item.instrumentId);
      if (list) list.push(item);
      else byInstrument.set(item.instrumentId, [item]);
    }
    const numbers = new Map<string, number>();
    for (const list of byInstrument.values()) {
      if (list.length < 2) continue;
      const ordered = [...list].sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt < b.createdAt ? -1 : 1;
        }
        return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
      });
      ordered.forEach((item, index) => numbers.set(item.itemId, index + 1));
    }
    return numbers;
  }, [items]);

  const {
    quotes,
    fetchedAt,
    zonesAvailable,
    loading: quotesLoading,
    refreshing: quotesRefreshing,
    error: quoteError,
    displayState,
    cooldownSecondsLeft,
    refresh: refreshQuotes,
  } = useLiveTradeQuotes(instrumentIds, instrumentIds.length > 0);

  const {
    summaries,
    loading: zonesLoading,
    error: zonesError,
    reload: reloadZones,
  } = useLiveTradeZoneSummaries(board !== null && items.length > 0);

  const filteredItems = useMemo(() => {
    const filters = { search, groupFilter, priorityFilter };
    return items.filter((item) => matchesFilters(item, filters));
  }, [items, search, groupFilter, priorityFilter]);

  const quoteSummary = useMemo<QuoteSummaryView>(() => {
    let live = 0;
    let delayed = 0;
    let lastClose = 0;
    let unavailable = 0;
    for (const quote of Object.values(quotes)) {
      if (quote.freshness === "LIVE") live += 1;
      else if (quote.freshness === "DELAYED") delayed += 1;
      else if (quote.freshness === "LAST_CLOSE") lastClose += 1;
      else unavailable += 1;
    }
    return {
      total: items.length,
      live,
      delayed,
      lastClose,
      unavailable,
    };
  }, [quotes, items.length]);

  const editingItem = items.find((item) => item.itemId === editingItemId) ?? null;
  const deleteTarget = items.find((item) => item.itemId === deleteItemId) ?? null;
  const expandedItem =
    items.find((item) => item.itemId === expandedItemId) ?? null;

  const activeGroupId =
    groupFilter !== "ALL" && groupFilter !== "UNGROUPED" ? groupFilter : null;

  const hasFilters =
    search.trim() !== "" || groupFilter !== "ALL" || priorityFilter !== "ALL";

  async function handleAdd(
    instrument: InstrumentSearchResult,
    groupId: string | null
  ) {
    const result = await runBoardTask(async ({ board: latest, apply }) => {
      // The entry is always new. Whether the instrument is already present
      // only decides the wording and whether the fresh plan editor opens.
      const isRepeat = latest.items.some(
        (item) => item.instrumentId === instrument.instrumentId
      );
      const created = await createItem({
        instrumentId: instrument.instrumentId,
        groupId,
      });
      // The server response is the authoritative row, so the list updates
      // immediately instead of waiting for a second board round trip.
      apply((previous) => ({
        ...previous,
        items: [...previous.items, created],
      }));
      return { created, isRepeat };
    });
    reloadZones();
    if (result.isRepeat) {
      setEditingItemId(result.created.itemId);
      push(
        "success",
        `Another ${instrument.symbol} trade entry was added. Enter this entry's own plan.`
      );
    } else {
      push("success", `${instrument.symbol} added to your board.`);
    }
  }

  async function handleSave(
    item: LiveTradeItemDto,
    payload: UpdateItemPayload
  ) {
    const updated = await runBoardTask(async ({ board: latest, apply }) => {
      const current = latest.items.find(
        (candidate) => candidate.itemId === item.itemId
      );
      if (!current) {
        throw new LiveTradeClientError(
          `${item.symbol} is no longer on your board.`,
          { status: 404, code: "NOT_FOUND" }
        );
      }
      // Another queued task (for example a reorder) may have bumped the
      // version since this editor opened; the server still rejects the write
      // when someone else changed the row.
      const next = await updateItem(item.itemId, {
        ...payload,
        version: current.version,
      });
      apply((previous) => ({
        ...previous,
        items: previous.items.map((candidate) =>
          candidate.itemId === next.itemId ? next : candidate
        ),
      }));
      return next;
    });
    // A different timeframe changes which zone is preferred, so only that
    // edit needs the heavier summary reads again.
    if (item.timeframe !== updated.timeframe) reloadZones();
    setEditingItemId(null);
    push("success", `${item.symbol} updated.`);
  }

  async function handleDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeletePending(true);
    markItemBusy(target.itemId, true);
    try {
      await runBoardTask(async ({ board: latest, apply }) => {
        const current = latest.items.find(
          (candidate) => candidate.itemId === target.itemId
        );
        if (!current) return;
        await deleteItem(current.itemId, current.version);
        apply((previous) => ({
          ...previous,
          items: previous.items.filter(
            (candidate) => candidate.itemId !== target.itemId
          ),
        }));
      });
      setDeleteItemId(null);
      push("success", `${target.symbol} trade entry removed from your board.`);
    } catch (cause) {
      push("error", liveTradeErrorMessage(cause));
    } finally {
      setDeletePending(false);
      markItemBusy(target.itemId, false);
    }
  }

  const handleReorder = useCallback(
    (item: LiveTradeItemDto, direction: "up" | "down") => {
      void (async () => {
        markItemBusy(item.itemId, true);
        try {
          await runBoardTask(async ({ board: latest, apply }) => {
            const orderedIds = reorderPayloadFor(
              latest.items,
              filtersRef.current,
              item.itemId,
              direction
            );
            if (orderedIds === null) return;
            const next = await reorderItems(orderedIds);
            apply((previous) => ({ ...previous, items: next }));
          });
        } catch (cause) {
          push("error", liveTradeErrorMessage(cause));
          if (
            isLiveTradeClientError(cause) &&
            (cause.code === "REORDER_STALE" || cause.code === "EDIT_CONFLICT")
          ) {
            await refetch();
          }
        } finally {
          markItemBusy(item.itemId, false);
        }
      })();
    },
    [markItemBusy, push, refetch, runBoardTask]
  );

  async function handleMoveGroup(
    item: LiveTradeItemDto,
    groupId: string | null
  ) {
    markItemBusy(item.itemId, true);
    try {
      await runBoardTask(async ({ board: latest, apply }) => {
        const current = latest.items.find(
          (candidate) => candidate.itemId === item.itemId
        );
        if (!current) return;
        const updated = await updateItem(item.itemId, {
          version: current.version,
          groupId,
        });
        apply((previous) => ({
          ...previous,
          items: previous.items.map((candidate) =>
            candidate.itemId === updated.itemId ? updated : candidate
          ),
        }));
      });
      push("success", `${item.symbol} moved.`);
    } catch (cause) {
      push("error", liveTradeErrorMessage(cause));
      if (isLiveTradeClientError(cause) && cause.code === "EDIT_CONFLICT") {
        await refetch();
      }
    } finally {
      markItemBusy(item.itemId, false);
    }
  }

  async function handleCreateGroup(name: string) {
    await runBoardTask(async ({ apply }) => {
      const created = await createGroup(name);
      apply((previous) => ({
        ...previous,
        groups: [...previous.groups, created],
      }));
    });
    push("success", `Group “${name}” created.`);
  }

  async function handleRenameGroup(
    group: { groupId: string; name: string; version: number },
    name: string
  ) {
    await runBoardTask(async ({ board: latest, apply }) => {
      const current = latest.groups.find(
        (candidate) => candidate.groupId === group.groupId
      );
      if (!current) {
        throw new LiveTradeClientError("That group no longer exists.", {
          status: 404,
          code: "NOT_FOUND",
        });
      }
      const updated = await updateGroup(
        group.groupId,
        name,
        current.version
      );
      apply((previous) => ({
        ...previous,
        groups: previous.groups.map((candidate) =>
          candidate.groupId === updated.groupId ? updated : candidate
        ),
      }));
    });
    push("success", "Group renamed.");
  }

  async function handleDeleteGroup(group: { groupId: string; version: number }) {
    await runBoardTask(async ({ board: latest, apply, refresh }) => {
      const current = latest.groups.find(
        (candidate) => candidate.groupId === group.groupId
      );
      if (!current) return;
      await deleteGroup(current.groupId, current.version);
      if (filtersRef.current.groupFilter === group.groupId) {
        filtersRef.current = { ...filtersRef.current, groupFilter: "ALL" };
        setGroupFilter("ALL");
      }
      apply((previous) => ({
        ...previous,
        groups: previous.groups.filter(
          (candidate) => candidate.groupId !== group.groupId
        ),
        items: previous.items.map((candidate) =>
          candidate.groupId === group.groupId
            ? { ...candidate, groupId: null }
            : candidate
        ),
      }));
      // Deleting a group also bumps the version of every item it held. Those
      // new versions are not in the delete response, so reconcile before this
      // task releases the queue and a later mutation reuses a stale version.
      await refresh();
    });
    push("success", "Group deleted. Its instruments are now ungrouped.");
  }

  async function handleReorderGroups(
    groupId: string,
    direction: "up" | "down"
  ) {
    await runBoardTask(async ({ board: latest, apply }) => {
      const orderedIds = groupReorderPayloadFor(
        latest.groups,
        groupId,
        direction
      );
      if (orderedIds === null) return;
      const next = await reorderGroups(orderedIds);
      apply((previous) => ({ ...previous, groups: next }));
    });
  }

  const appSessionExpired = error?.status === 401;
  const brokerIssue =
    brokerConnected === false ||
    displayState === "broker" ||
    quoteError?.code === "BROKER_NOT_CONNECTED" ||
    quoteError?.code === "TOKEN_EXPIRED";

  return (
    <div className="ds-live-trade space-y-5">
      <WorkspaceHeader
        entryCount={items.length}
        groupCount={groups.length}
        fetchedAt={fetchedAt}
        quoteSummary={quoteSummary}
        quotesLoading={quotesLoading}
        quotesRefreshing={quotesRefreshing}
        quoteError={quoteError ? liveTradeErrorMessage(quoteError) : null}
        displayState={displayState}
        cooldownSecondsLeft={cooldownSecondsLeft}
        onRefreshQuotes={refreshQuotes}
      />

      {appSessionExpired && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-[var(--ds-gold-300)] bg-[var(--ds-warning-soft)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--ds-warning)]">
              Your DemandScan session needs attention
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ds-text-secondary)]">
              Sign in again to view and change your board. Nothing has been removed from your workspace.
            </p>
          </div>
          <SignInLink />
        </div>
      )}

      {brokerIssue && !appSessionExpired && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-[var(--ds-gold-300)] bg-[var(--ds-warning-soft)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--ds-warning)]">
              Connect Kite to load live quotes
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ds-text-secondary)]">
              Your board and plans stay available. Quotes require your own Kite connection and are never fetched from another account.
            </p>
          </div>
          <ReconnectLink />
        </div>
      )}

      {error && !appSessionExpired && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-[var(--ds-negative)]/25 bg-[var(--ds-negative-soft)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--ds-negative)]">
              {board ? "The workspace could not be refreshed" : "The workspace could not be loaded"}
            </p>
            <p className="mt-1 text-xs text-[var(--ds-text-secondary)]">
              {liveTradeErrorMessage(error)}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={refreshing || loading}
            onClick={() => void refetch()}
            className="min-h-11 border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] focus-visible:ring-offset-[var(--ds-canvas)]"
          >
            Try again
          </Button>
        </div>
      )}

      {loading && !board ? (
        <WorkspaceSkeleton />
      ) : !board ? (
        <div className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-5 py-12 text-center shadow-[var(--ds-shadow-card)]">
          <p className="text-sm font-medium text-[var(--ds-text-secondary)]">
            The workspace is unavailable right now.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4 min-h-11 border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text)] hover:bg-[var(--ds-gold-50)] focus-visible:ring-offset-[var(--ds-canvas)]"
            onClick={() => void refetch()}
          >
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <aside className="order-first space-y-4 xl:order-last">
            <InstrumentSearch
              items={items}
              enabled
              atLimit={items.length >= LIVE_TRADE_ITEM_LIMIT}
              activeGroupId={activeGroupId}
              onAdd={handleAdd}
            />
            <CoverageGuide />
          </aside>

          <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--ds-border-strong)] bg-[var(--ds-surface)] px-6 py-12 text-center shadow-[var(--ds-shadow-card)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--ds-gold-300)] bg-[var(--ds-gold-50)] text-[var(--ds-gold-700)]">
              <ChartCandlestick className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ds-gold-700)]">
              Start with context
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-[var(--ds-text)]">
              Your board is empty
            </h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[var(--ds-text-secondary)]">
              Search for an active NSE stock to start planning. Adding an instrument only saves it to your personal board — it never places an order.
            </p>
            <div className="mt-6 grid w-full max-w-lg gap-2 text-left sm:grid-cols-3">
              {[
                ["Private board", "Entries belong to your account."],
                ["Independent plans", "Repeat symbols keep separate setups."],
                ["Clear evidence", "Quotes and zones stay distinct."],
              ].map(([title, detail]) => (
                <div key={title} className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-gold-50)]/50 px-3 py-3">
                  <p className="text-[11px] font-bold text-[var(--ds-text)]">{title}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--ds-text-muted)]">{detail}</p>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-6 min-h-11 border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] focus-visible:ring-offset-[var(--ds-canvas)]"
              onClick={() => setGroupManagerOpen(true)}
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Create groups
            </Button>
          </section>
        </div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <aside className="order-first space-y-4 xl:order-last xl:sticky xl:top-20">
            <InstrumentSearch
              items={items}
              enabled
              atLimit={items.length >= LIVE_TRADE_ITEM_LIMIT}
              activeGroupId={activeGroupId}
              onAdd={handleAdd}
            />
            {groups.length === 0 && (
              <p className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 py-3 text-[11px] leading-relaxed text-[var(--ds-text-muted)]">
                No groups yet. Use “Manage groups” to organise the watchlist; instruments stay on the board when groups change.
              </p>
            )}
          </aside>

          <div className="min-w-0 space-y-4">
            <WatchlistToolbar
              search={search}
              onSearchChange={setSearch}
              groupFilter={groupFilter}
              onGroupFilterChange={setGroupFilter}
              priorityFilter={priorityFilter}
              onPriorityFilterChange={setPriorityFilter}
              groups={groups}
              total={items.length}
              shown={filteredItems.length}
              onManageGroups={() => setGroupManagerOpen(true)}
              onClearFilters={() => {
                setSearch("");
                setGroupFilter("ALL");
                setPriorityFilter("ALL");
              }}
            />

            {refreshing && (
              <p role="status" className="flex items-center gap-2 text-[11px] text-[var(--ds-text-muted)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ds-gold-500)]" aria-hidden="true" />
                Refreshing board…
              </p>
            )}

            {zonesError !== null && (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-xl border border-[var(--ds-gold-300)] bg-[var(--ds-warning-soft)] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-[11px] leading-relaxed text-[var(--ds-warning)]">
                  Live zone summaries could not be loaded. Prices and plans are unaffected.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={zonesLoading}
                  onClick={reloadZones}
                  className="min-h-11 shrink-0 border-[var(--ds-gold-300)] text-[var(--ds-warning)] hover:bg-[var(--ds-gold-100)] focus-visible:ring-offset-[var(--ds-warning-soft)]"
                >
                  Retry zones
                </Button>
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-5 py-12 text-center shadow-[var(--ds-shadow-card)]">
                <SearchX className="mx-auto h-7 w-7 text-[var(--ds-text-muted)]" strokeWidth={1.5} aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-[var(--ds-text)]">
                  No instruments match these filters.
                </p>
                <p className="mt-1 text-xs text-[var(--ds-text-muted)]">
                  {formatCount(items.length)} trade entries are tracked in total.
                </p>
                {hasFilters && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-4 min-h-11 border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text)] hover:bg-[var(--ds-gold-50)] focus-visible:ring-offset-[var(--ds-canvas)]"
                    onClick={() => {
                      setSearch("");
                      setGroupFilter("ALL");
                      setPriorityFilter("ALL");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <Watchlist
                items={filteredItems}
                entryNumbers={entryNumbers}
                groups={groups}
                summaries={summaries}
                quotes={quotes}
                quoteDisplayState={displayState}
                zonesAvailable={zonesAvailable}
                zonesLoading={zonesLoading}
                zonesError={zonesError !== null}
                quoteLoading={quotesLoading}
                busyItemIds={busyItemIds}
                onEdit={(item) => setEditingItemId(item.itemId)}
                onDelete={(item) => setDeleteItemId(item.itemId)}
                onExpandZones={(item) => setExpandedItemId(item.itemId)}
                onMoveGroup={(item, groupId) =>
                  void handleMoveGroup(item, groupId)
                }
                onReorder={handleReorder}
              />
            )}

            <CoverageGuide />
          </div>
        </div>
      )}

      {editingItem && (
        <ItemEditor
          key={editingItem.itemId}
          item={editingItem}
          groups={groups}
          onClose={() => setEditingItemId(null)}
          onSave={handleSave}
          onConflictReload={refetch}
        />
      )}

      {expandedItem && (
        <ExpandedZones
          item={expandedItem}
          summary={summaries.get(expandedItem.instrumentId)}
          zonesLoading={zonesLoading}
          zonesError={zonesError !== null}
          onRetryZones={reloadZones}
          onClose={() => setExpandedItemId(null)}
        />
      )}

      {groupManagerOpen && (
        <GroupManager
          groups={groups}
          onClose={() => setGroupManagerOpen(false)}
          onCreate={handleCreateGroup}
          onRename={handleRenameGroup}
          onDelete={handleDeleteGroup}
          onReorder={handleReorderGroups}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={
          deleteTarget
            ? `Remove ${deleteTarget.symbol} trade entry?`
            : "Remove trade entry"
        }
        description={
          deleteTarget
            ? `This ${deleteTarget.symbol} trade entry will be removed with its saved plan. Other entries for ${deleteTarget.symbol}, scanner zones and market data are not affected.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        pending={deletePending}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deletePending) setDeleteItemId(null);
        }}
      />

      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
