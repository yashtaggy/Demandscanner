"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  SearchX,
  TriangleAlert,
} from "lucide-react";
import { cn, formatINR, formatVolume, formatPercent, formatDateTime } from "@/lib/utils";
import { StockTableSkeleton } from "@/components/ui/skeleton";
import type { StockRow } from "@/lib/types";

// ─── Column definitions ───────────────────────────────────────────────────────

type SortField = "symbol" | "price" | "change" | "changePercent" | "volume";

interface Column {
  key: SortField | "name" | "lastUpdated";
  label: string;
  sortable: boolean;
  align: "left" | "right";
  className: string;
}

const COLUMNS: Column[] = [
  { key: "symbol", label: "Symbol", sortable: true, align: "left", className: "w-[108px]" },
  { key: "name", label: "Company", sortable: false, align: "left", className: "min-w-0" },
  { key: "price", label: "LTP", sortable: true, align: "right", className: "w-[104px]" },
  { key: "change", label: "Change", sortable: true, align: "right", className: "w-[104px]" },
  { key: "changePercent", label: "% Change", sortable: true, align: "right", className: "w-[112px]" },
  {
    key: "volume",
    label: "Volume",
    sortable: true,
    align: "right",
    className: "hidden w-[112px] lg:table-cell",
  },
  {
    key: "lastUpdated",
    label: "Updated",
    sortable: false,
    align: "right",
    className: "hidden w-[120px] xl:table-cell",
  },
];

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ field, currentSort, currentOrder }: {
  field: string;
  currentSort: string;
  currentOrder: string;
}) {
  if (field !== currentSort) {
    return (
      <ArrowUpDown
        className="h-3 w-3 text-[var(--ds-text-muted)] opacity-60 transition-opacity group-hover:opacity-100"
        strokeWidth={2}
        aria-hidden="true"
      />
    );
  }
  return currentOrder === "asc" ? (
    <ArrowUp className="h-3 w-3 text-[var(--ds-gold-700)]" strokeWidth={2.5} aria-hidden="true" />
  ) : (
    <ArrowDown className="h-3 w-3 text-[var(--ds-gold-700)]" strokeWidth={2.5} aria-hidden="true" />
  );
}

// ─── Stock table props ────────────────────────────────────────────────────────

interface StockTableProps {
  stocks: StockRow[];
  loading: boolean;
  error: string | null;
  sort: SortField;
  order: "asc" | "desc";
  onSort: (field: SortField) => void;
  onRowClick?: (stock: StockRow) => void;
  onRetry?: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

// ─── Main table ───────────────────────────────────────────────────────────────

export function StockTable({
  stocks,
  loading,
  error,
  sort,
  order,
  onSort,
  onRowClick,
  onRetry,
  page,
  totalPages,
  total,
  onPageChange,
}: StockTableProps) {
  if (loading && stocks.length === 0) {
    return <StockTableSkeleton rows={12} />;
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 rounded-2xl border px-6 py-20 text-center"
        style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--ds-negative-soft)", color: "var(--ds-negative)" }}
        >
          <TriangleAlert className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--ds-text)]">Failed to load stocks</p>
          <p className="mt-1 text-xs text-[var(--ds-text-muted)]">{error}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            id="retry-button"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ds-border-strong)] bg-[var(--ds-surface-elevated)] px-3.5 text-xs font-semibold text-[var(--ds-text)] transition-colors hover:bg-[var(--ds-surface-subtle)]"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!loading && stocks.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border px-6 py-20 text-center"
        style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--ds-surface-subtle)", color: "var(--ds-text-muted)" }}
        >
          <SearchX className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="text-sm text-[var(--ds-text-secondary)]">
          No stocks match the current filters.
        </p>
      </div>
    );
  }

  const handleColumnClick = (col: Column) => {
    if (!col.sortable || col.key === "name" || col.key === "lastUpdated") return;
    onSort(col.key as SortField);
  };

  return (
    <div className="space-y-3">
      {/* Loading overlay when refreshing with existing data */}
      {loading && stocks.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--ds-text-muted)]" role="status">
          <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2.5} aria-hidden="true" />
          Refreshing…
        </div>
      )}

      {/* Table */}
      <div
        className="overflow-x-auto rounded-2xl border lg:max-h-[64vh] lg:overflow-y-auto"
        style={{
          borderColor: "var(--ds-border)",
          background: "var(--ds-surface)",
          boxShadow: "var(--ds-shadow-card)",
        }}
      >
        <table className="w-full min-w-[640px] border-collapse text-sm" id="stock-table">
          <caption className="sr-only">
            Nifty 500 instruments with latest price, change and volume
          </caption>
          <thead className="sticky top-0 z-10">
            <tr
              className="border-b"
              style={{
                borderColor: "var(--ds-border)",
                background: "var(--ds-surface-elevated)",
              }}
            >
              {COLUMNS.map((col) => {
                const isActive = sort === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      col.sortable
                        ? isActive
                          ? order === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    className={cn(
                      "px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--ds-text-muted)] select-none first:pl-4 last:pr-4 sm:px-4",
                      col.className
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleColumnClick(col)}
                        className={cn(
                          "group inline-flex items-center gap-1 rounded-md text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors hover:text-[var(--ds-text)]",
                          col.align === "right" && "w-full justify-end"
                        )}
                      >
                        {col.label}
                        <SortIcon field={col.key} currentSort={sort} currentOrder={order} />
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex w-full",
                          col.align === "right" && "justify-end"
                        )}
                      >
                        {col.label}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => (
              <StockRow
                key={stock.fullSymbol}
                stock={stock}
                onClick={onRowClick ? () => onRowClick(stock) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-2 text-sm sm:flex-row">
          <span className="ds-mono text-[11px] text-[var(--ds-text-muted)]">
            {total.toLocaleString("en-IN")} stocks · Page {page} of {totalPages}
          </span>
          <nav className="flex items-center gap-1" aria-label="Table pagination">
            <PageButton
              id="prev-page-button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              <span className="hidden sm:inline">Prev</span>
            </PageButton>
            {/* Show nearby page numbers */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pageNum = Math.max(1, Math.min(page - 2 + i, totalPages - 4 + i));
              return (
                <PageButton
                  key={pageNum}
                  id={`page-${pageNum}-button`}
                  onClick={() => onPageChange(pageNum)}
                  active={pageNum === page}
                  label={`Page ${pageNum}`}
                >
                  {pageNum}
                </PageButton>
              );
            })}
            <PageButton
              id="next-page-button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              label="Next page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </PageButton>
          </nav>
        </div>
      )}
    </div>
  );
}

// ─── Pagination button ────────────────────────────────────────────────────────

function PageButton({
  active,
  disabled,
  onClick,
  id,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "ds-mono inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-transparent bg-[var(--ds-text)] text-[var(--ds-surface)]"
          : "border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-secondary)] hover:border-[var(--ds-border-strong)] hover:text-[var(--ds-text)]"
      )}
    >
      {children}
    </button>
  );
}

// ─── Individual row ───────────────────────────────────────────────────────────

function StockRow({
  stock,
  onClick,
}: {
  stock: StockRow;
  onClick?: () => void;
}) {
  const isPositive = stock.changePercent > 0;
  const isNegative = stock.changePercent < 0;

  const changeTone = !stock.hasQuote
    ? "var(--ds-text-muted)"
    : stock.change > 0
    ? "var(--ds-positive)"
    : stock.change < 0
    ? "var(--ds-negative)"
    : "var(--ds-text-secondary)";

  const percentTone = !stock.hasQuote
    ? "var(--ds-text-muted)"
    : isPositive
    ? "var(--ds-positive)"
    : isNegative
    ? "var(--ds-negative)"
    : "var(--ds-text-secondary)";

  return (
    <tr
      className={cn(
        "border-b border-[var(--ds-border)]/60 transition-colors last:border-b-0",
        "hover:bg-[var(--ds-gold-50)]",
        onClick && "cursor-pointer",
        !stock.hasQuote && "opacity-60"
      )}
      onClick={onClick}
      id={`stock-row-${stock.symbol}`}
    >
      {/* Symbol */}
      <td className="px-3 py-2.5 first:pl-4 sm:px-4">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: stock.hasQuote
                ? isPositive
                  ? "var(--ds-positive)"
                  : isNegative
                  ? "var(--ds-negative)"
                  : "var(--ds-text-muted)"
                : "var(--ds-border-strong)",
            }}
            aria-hidden="true"
          />
          <span className="ds-mono text-[12px] font-semibold tracking-wide text-[var(--ds-text)]">
            {stock.symbol}
          </span>
        </div>
      </td>

      {/* Company name */}
      <td className="px-3 py-2.5 sm:px-4">
        <span className="block max-w-[240px] truncate text-[12.5px] text-[var(--ds-text-secondary)]">
          {stock.name || "—"}
        </span>
      </td>

      {/* LTP */}
      <td className="px-3 py-2.5 text-right sm:px-4">
        <span className="ds-mono text-[13px] font-medium text-[var(--ds-text)]">
          {stock.hasQuote ? formatINR(stock.lastPrice) : "—"}
        </span>
      </td>

      {/* Change */}
      <td className="px-3 py-2.5 text-right sm:px-4">
        <span className="ds-mono text-[12.5px]" style={{ color: changeTone }}>
          {stock.hasQuote
            ? `${stock.change >= 0 ? "+" : ""}${formatINR(stock.change)}`
            : "—"}
        </span>
      </td>

      {/* % Change */}
      <td className="px-3 py-2.5 text-right sm:px-4">
        <span
          className="ds-mono inline-flex items-center justify-end gap-1 text-[12.5px] font-semibold"
          style={{ color: percentTone }}
        >
          {stock.hasQuote ? (
            <>
              {isPositive ? (
                <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              ) : isNegative ? (
                <ArrowDownRight className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              ) : null}
              {formatPercent(stock.changePercent)}
            </>
          ) : (
            "—"
          )}
        </span>
      </td>

      {/* Volume */}
      <td className="hidden px-3 py-2.5 text-right sm:px-4 lg:table-cell">
        <span className="ds-mono text-[12px] text-[var(--ds-text-secondary)]">
          {stock.hasQuote ? formatVolume(stock.volume) : "—"}
        </span>
      </td>

      {/* Last updated */}
      <td className="hidden px-3 py-2.5 text-right sm:px-4 xl:table-cell">
        <span className="ds-mono text-[11px] text-[var(--ds-text-muted)]">
          {formatDateTime(stock.lastUpdated || undefined)}
        </span>
      </td>
    </tr>
  );
}
