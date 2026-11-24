"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SCANNER_FILTERS,
  type ZoneFilters,
} from "@/hooks/use-zones";
import {
  COMPOSITE_UNAVAILABLE_REASON,
  LIFECYCLES,
  LIFECYCLE_LABELS,
  PATTERNS,
  SIDES,
  SIDE_LABELS,
  SORT_OPTIONS,
  TF_LABELS,
  TF_TITLES,
  TIMEFRAMES,
} from "./filter-options";
import { FilterChip } from "./filter-chip";

interface ScannerFilterBarProps {
  filters: ZoneFilters;
  onFiltersChange: (f: ZoneFilters) => void;
  onResetFilters: () => void;
  isAuthenticated: boolean;
}

interface ActiveChip {
  key: string;
  label: string;
  clear: () => void;
}

function AdvancedSection({
  id,
  title,
  children,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface-elevated)" }}
    >
      <h3>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[var(--ds-gold-50)]"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ds-text-secondary)]">
            {title}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[var(--ds-text-muted)] transition-transform duration-200",
              open && "rotate-180"
            )}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div
        id={`${id}-panel`}
        hidden={!open}
        className="space-y-4 border-t px-3 py-3"
        style={{ borderColor: "var(--ds-border)" }}
      >
        {children}
      </div>
    </section>
  );
}

function SliderRow({
  id,
  label,
  value,
  max,
  step = 5,
  suffix,
  onChange,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold text-[var(--ds-text-secondary)]"
      >
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={`${value}${suffix}`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer rounded-full accent-[var(--ds-gold-500)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex justify-between text-[10px] text-[var(--ds-text-muted)]">
        <span>0{suffix}</span>
        <span>
          {Math.round(max / 2)}
          {suffix}
        </span>
        <span>
          {max}
          {suffix}
        </span>
      </div>
      {hint && (
        <p className="text-[10.5px] leading-relaxed text-[var(--ds-text-muted)]">{hint}</p>
      )}
    </div>
  );
}

export function ScannerFilterBar({
  filters,
  onFiltersChange,
  onResetFilters,
  isAuthenticated,
}: ScannerFilterBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const advancedRef = useRef<HTMLDivElement | null>(null);
  const advancedCloseRef = useRef<HTMLButtonElement | null>(null);

  function set(patch: Partial<ZoneFilters>) {
    onFiltersChange({ ...filters, ...patch, offset: 0 });
  }

  const activeTf = filters.timeframe ?? "ALL";
  const activeSide = filters.side ?? "ALL";
  const activePattern = filters.pattern ?? "ALL";
  const activeLifecycle = filters.lifecycle ?? "ALL";
  const minScore = filters.minScore ?? DEFAULT_SCANNER_FILTERS.minScore ?? 0;
  const sortValue = filters.sort ?? DEFAULT_SCANNER_FILTERS.sort ?? "score";
  const dirValue = filters.dir ?? DEFAULT_SCANNER_FILTERS.dir ?? "desc";

  const advancedCount = [
    filters.maxDistancePct !== undefined,
    filters.minConfluence !== undefined,
    filters.maxOppositionRisk !== undefined,
    Boolean(filters.formationFrom),
    Boolean(filters.formationTo),
  ].filter(Boolean).length;

  const chips = useMemo<ActiveChip[]>(() => {
    const list: ActiveChip[] = [];
    if (filters.symbol) {
      list.push({
        key: "symbol",
        label: filters.symbol,
        clear: () => set({ symbol: undefined }),
      });
    }
    if (filters.timeframe) {
      list.push({
        key: "timeframe",
        label: TF_TITLES[filters.timeframe] ?? filters.timeframe,
        clear: () => set({ timeframe: undefined }),
      });
    }
    if (filters.side) {
      list.push({
        key: "side",
        label: SIDE_LABELS[filters.side] ?? filters.side,
        clear: () => set({ side: undefined }),
      });
    }
    if (filters.pattern) {
      list.push({
        key: "pattern",
        label: filters.pattern,
        clear: () => set({ pattern: undefined }),
      });
    }
    if (filters.lifecycle) {
      list.push({
        key: "lifecycle",
        label: LIFECYCLE_LABELS[filters.lifecycle] ?? filters.lifecycle,
        clear: () => set({ lifecycle: undefined }),
      });
    }
    if (filters.minScore !== undefined) {
      list.push({
        key: "minScore",
        label: `Formation score ≥ ${filters.minScore}`,
        clear: () => set({ minScore: undefined }),
      });
    }
    if (filters.minCompositeScore !== undefined) {
      list.push({
        key: "minCompositeScore",
        label: `Composite score ≥ ${filters.minCompositeScore}`,
        clear: () => set({ minCompositeScore: undefined }),
      });
    }
    if (filters.maxDistancePct !== undefined) {
      list.push({
        key: "maxDistancePct",
        label: `Within ${filters.maxDistancePct}% of price`,
        clear: () => set({ maxDistancePct: undefined }),
      });
    }
    if (filters.minConfluence !== undefined) {
      list.push({
        key: "minConfluence",
        label: `Confluence ≥ ${filters.minConfluence}`,
        clear: () => set({ minConfluence: undefined }),
      });
    }
    if (filters.maxOppositionRisk !== undefined) {
      list.push({
        key: "maxOppositionRisk",
        label: `Opposition risk ≤ ${filters.maxOppositionRisk}`,
        clear: () => set({ maxOppositionRisk: undefined }),
      });
    }
    if (filters.formationFrom) {
      list.push({
        key: "formationFrom",
        label: `Formed from ${filters.formationFrom}`,
        clear: () => set({ formationFrom: undefined }),
      });
    }
    if (filters.formationTo) {
      list.push({
        key: "formationTo",
        label: `Formed to ${filters.formationTo}`,
        clear: () => set({ formationTo: undefined }),
      });
    }
    return list;
    // set() closes over the current filters; every field is represented above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Close the mobile sheet when the viewport reaches the desktop breakpoint so
  // its scroll lock can never survive a resize.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setSheetOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Mobile sheet: modal semantics, scroll lock, focus containment.
  useEffect(() => {
    if (!sheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetCloseRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSheetOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sheetOpen]);

  // Desktop advanced drawer: focus containment without locking the page.
  useEffect(() => {
    if (!advancedOpen) return;
    advancedCloseRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAdvancedOpen(false);
        return;
      }
      if (event.key !== "Tab" || !advancedRef.current) return;
      const focusable = advancedRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [advancedOpen]);

  const disabled = !isAuthenticated;

  return (
    <div className="ds-scanner-light">
      <div
        className="rounded-2xl border p-2.5 sm:p-3"
        style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Symbol search — always visible */}
          <div className="relative min-w-[160px] flex-1 sm:max-w-[260px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ds-text-muted)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <label htmlFor="symbol-search" className="sr-only">
              Search symbol
            </label>
            <input
              id="symbol-search"
              type="text"
              placeholder="Search symbol…"
              value={filters.symbol ?? ""}
              disabled={disabled}
              onChange={(event) =>
                set({ symbol: event.target.value.toUpperCase() || undefined })
              }
              className="h-10 w-full rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] pl-9 pr-8 text-sm text-[var(--ds-text)] placeholder:text-[var(--ds-text-muted)] transition-colors focus:border-[var(--ds-gold-500)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-100)] disabled:opacity-60"
            />
            {filters.symbol && (
              <button
                type="button"
                onClick={() => set({ symbol: undefined })}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)]"
                aria-label="Clear symbol"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Filters surface: inline on desktop, full-screen sheet on mobile */}
          <div
            ref={sheetRef}
            role={sheetOpen ? "dialog" : undefined}
            aria-modal={sheetOpen ? "true" : undefined}
            aria-labelledby={sheetOpen ? "filter-sheet-title" : undefined}
            className={cn(
              sheetOpen
                ? "fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[var(--ds-surface)]"
                : "hidden md:flex md:min-w-0 md:flex-1 md:flex-wrap md:items-center md:gap-3"
            )}
            style={{ paddingTop: sheetOpen ? "env(safe-area-inset-top)" : undefined }}
          >
            {sheetOpen && (
              <div
                className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-4 py-3"
                style={{
                  borderColor: "var(--ds-border)",
                  background: "color-mix(in srgb, var(--ds-surface) 94%, transparent)",
                }}
              >
                <div className="min-w-0">
                  <h2
                    id="filter-sheet-title"
                    className="text-[15px] font-semibold text-[var(--ds-text)]"
                  >
                    Filters
                  </h2>
                  <p className="text-[11px] text-[var(--ds-text-muted)]">
                    {chips.length} active
                  </p>
                </div>
                <button
                  ref={sheetCloseRef}
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border text-[var(--ds-text-secondary)]"
                  style={{ borderColor: "var(--ds-border)" }}
                  aria-label="Close filters"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            )}

            <div
              className={cn(
                "flex flex-wrap items-start gap-x-4 gap-y-3",
                sheetOpen ? "px-4 py-4" : "min-w-0 flex-1"
              )}
            >
              {/* Timeframe */}
              <div role="group" aria-labelledby="filter-tf-label" className="min-w-0">
                <p
                  id="filter-tf-label"
                  className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ds-text-muted)]"
                >
                  Timeframe
                </p>
                <div className="flex flex-wrap gap-1">
                  {TIMEFRAMES.map((tf) => (
                    <FilterChip
                      key={tf}
                      id={`tf-${tf}`}
                      active={activeTf === tf}
                      title={TF_TITLES[tf]}
                      onClick={() => set({ timeframe: tf === "ALL" ? undefined : tf })}
                      className="px-2 py-1 text-[11px]"
                    >
                      {TF_LABELS[tf]}
                    </FilterChip>
                  ))}
                </div>
              </div>

              {/* Side */}
              <div role="group" aria-labelledby="filter-side-label">
                <p
                  id="filter-side-label"
                  className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ds-text-muted)]"
                >
                  Side
                </p>
                <div className="flex gap-1">
                  {SIDES.map((side) => (
                    <FilterChip
                      key={side}
                      id={`side-${side}`}
                      active={activeSide === side}
                      tone={side === "DEMAND" ? "positive" : side === "SUPPLY" ? "negative" : undefined}
                      onClick={() => set({ side: side === "ALL" ? undefined : side })}
                      className="px-2 py-1 text-[11px]"
                    >
                      {SIDE_LABELS[side]}
                    </FilterChip>
                  ))}
                </div>
              </div>

              {/* Pattern */}
              <div role="group" aria-labelledby="filter-pattern-label">
                <p
                  id="filter-pattern-label"
                  className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ds-text-muted)]"
                >
                  Pattern
                </p>
                <div className="flex flex-wrap gap-1">
                  {PATTERNS.map((pattern) => (
                    <FilterChip
                      key={pattern}
                      id={`pattern-${pattern}`}
                      active={activePattern === pattern}
                      onClick={() => set({ pattern: pattern === "ALL" ? undefined : pattern })}
                      className="px-2 py-1 text-[11px]"
                    >
                      {pattern === "ALL" ? "All" : pattern}
                    </FilterChip>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div role="group" aria-labelledby="filter-status-label">
                <p
                  id="filter-status-label"
                  className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ds-text-muted)]"
                >
                  Status
                </p>
                <div className="flex flex-wrap gap-1">
                  {LIFECYCLES.map((lifecycle) => (
                    <FilterChip
                      key={lifecycle}
                      id={`lc-${lifecycle}`}
                      active={activeLifecycle === lifecycle}
                      onClick={() => set({ lifecycle: lifecycle === "ALL" ? undefined : lifecycle })}
                      className="px-2 py-1 text-[11px]"
                    >
                      {LIFECYCLE_LABELS[lifecycle]}
                    </FilterChip>
                  ))}
                </div>
              </div>
            </div>

            {(activeTf === "1H" || activeTf === "4H") && (
              <p
                className={cn(
                  "text-[10.5px] leading-relaxed text-[var(--ds-warning)]",
                  sheetOpen ? "px-4" : "hidden md:block md:pb-1"
                )}
              >
                {activeTf === "1H"
                  ? "1H: session candles (09:15–15:30 IST)"
                  : "4H: AM session only (09:15–13:15 IST, complete bars)"}
              </p>
            )}

            {/* Advanced filters: desktop drawer, inline section on mobile */}
            <div
              ref={advancedRef}
              role={advancedOpen ? "dialog" : undefined}
              aria-modal={advancedOpen ? "true" : undefined}
              aria-labelledby={advancedOpen ? "advanced-filters-title" : undefined}
              className={cn(
                advancedOpen ? "md:block" : "md:hidden",
                "max-md:block w-full md:fixed md:inset-y-0 md:right-0 md:z-50 md:w-[420px] md:max-w-[92vw] md:overflow-y-auto md:border-l md:shadow-2xl",
                sheetOpen ? "mt-2 px-4 pb-6" : "md:mt-0"
              )}
              style={{
                borderColor: "var(--ds-border)",
                background: "var(--ds-surface)",
                paddingTop: advancedOpen ? "env(safe-area-inset-top)" : undefined,
                paddingBottom: advancedOpen ? "env(safe-area-inset-bottom)" : undefined,
              }}
            >
              {advancedOpen && (
                <div
                  className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-4 py-3"
                  style={{
                    borderColor: "var(--ds-border)",
                    background: "color-mix(in srgb, var(--ds-surface) 94%, transparent)",
                  }}
                >
                  <div>
                    <h2
                      id="advanced-filters-title"
                      className="text-[15px] font-semibold text-[var(--ds-text)]"
                    >
                      Advanced filters
                    </h2>
                    <p className="text-[11px] text-[var(--ds-text-muted)]">
                      {advancedCount} active
                    </p>
                  </div>
                  <button
                    ref={advancedCloseRef}
                    type="button"
                    onClick={() => setAdvancedOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border text-[var(--ds-text-secondary)]"
                    style={{ borderColor: "var(--ds-border)" }}
                    aria-label="Close advanced filters"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className={cn("space-y-3", advancedOpen ? "p-4" : "")}>
                {!advancedOpen && !sheetOpen && (
                  <p className="sr-only">Advanced filter controls</p>
                )}

                <AdvancedSection id="filter-quality" title="Zone quality">
                  <SliderRow
                    id="min-score-slider"
                    label={`Formation Score ≥ ${minScore}`}
                    value={minScore}
                    max={100}
                    suffix=""
                    onChange={(value) => set({ minScore: value })}
                    hint="Formation score is always available for persisted zones."
                  />

                  <div className="space-y-1.5">
                    <label
                      htmlFor="min-composite-slider"
                      className="block text-[11px] font-semibold text-[var(--ds-text-muted)]"
                    >
                      Composite Score ≥ {filters.minCompositeScore ?? 0}
                    </label>
                    <input
                      id="min-composite-slider"
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={filters.minCompositeScore ?? 0}
                      disabled
                      aria-disabled="true"
                      aria-describedby="composite-unavailable-note"
                      className="h-1.5 w-full cursor-not-allowed rounded-full opacity-40"
                    />
                    <p
                      id="composite-unavailable-note"
                      className="text-[10.5px] leading-relaxed text-[var(--ds-text-muted)]"
                    >
                      {COMPOSITE_UNAVAILABLE_REASON}
                    </p>
                  </div>

                  <SliderRow
                    id="min-conf-slider"
                    label={`Min Confluence ≥ ${filters.minConfluence ?? 0}`}
                    value={filters.minConfluence ?? 0}
                    max={100}
                    suffix=""
                    onChange={(value) =>
                      set({ minConfluence: value > 0 ? value : undefined })
                    }
                  />

                  <SliderRow
                    id="max-opp-slider"
                    label={`Max Opposition Risk ≤ ${filters.maxOppositionRisk ?? 100}`}
                    value={filters.maxOppositionRisk ?? 100}
                    max={100}
                    suffix=""
                    onChange={(value) =>
                      set({ maxOppositionRisk: value < 100 ? value : undefined })
                    }
                  />
                </AdvancedSection>

                <AdvancedSection id="filter-price" title="Price relationship">
                  <SliderRow
                    id="max-dist-slider"
                    label={`Max Distance from Price ≤ ${filters.maxDistancePct ?? 20}%`}
                    value={filters.maxDistancePct ?? 20}
                    max={20}
                    step={0.5}
                    suffix="%"
                    onChange={(value) =>
                      set({ maxDistancePct: value < 20 ? value : undefined })
                    }
                  />
                </AdvancedSection>

                <AdvancedSection id="filter-period" title="Formation period">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="formation-from"
                        className="mb-1 block text-[11px] font-semibold text-[var(--ds-text-secondary)]"
                      >
                        From
                      </label>
                      <input
                        id="formation-from"
                        type="date"
                        value={filters.formationFrom ?? ""}
                        onChange={(event) =>
                          set({ formationFrom: event.target.value || undefined })
                        }
                        className="h-9 w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2 text-xs text-[var(--ds-text)] focus:border-[var(--ds-gold-500)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-100)]"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="formation-to"
                        className="mb-1 block text-[11px] font-semibold text-[var(--ds-text-secondary)]"
                      >
                        To
                      </label>
                      <input
                        id="formation-to"
                        type="date"
                        value={filters.formationTo ?? ""}
                        onChange={(event) =>
                          set({ formationTo: event.target.value || undefined })
                        }
                        className="h-9 w-full rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2 text-xs text-[var(--ds-text)] focus:border-[var(--ds-gold-500)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-100)]"
                      />
                    </div>
                  </div>
                </AdvancedSection>

                <button
                  id="reset-filters-btn"
                  type="button"
                  onClick={onResetFilters}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]",
                    sheetOpen && "mt-2 w-full justify-center"
                  )}
                  style={{ borderColor: "var(--ds-border)" }}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Reset filters
                </button>
              </div>
            </div>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="sort-select" className="sr-only">
              Sort results by
            </label>
            <select
              id="sort-select"
              value={sortValue}
              disabled={disabled}
              onChange={(event) =>
                set({ sort: event.target.value as ZoneFilters["sort"] })
              }
              className="h-10 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-2 text-[12px] text-[var(--ds-text)] focus:border-[var(--ds-gold-500)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-gold-100)] disabled:opacity-60"
            >
              {SORT_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.value === "composite_score"}
                >
                  {option.label}
                  {option.value === "composite_score" ? " (unavailable)" : ""}
                </option>
              ))}
            </select>
            <div
              className="inline-flex items-center rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] p-0.5"
              role="group"
              aria-label="Sort direction"
            >
              <button
                id="dir-desc"
                type="button"
                aria-pressed={dirValue === "desc"}
                aria-label="Sort descending"
                onClick={() => set({ dir: "desc" })}
                className={cn(
                  "rounded-[9px] px-2 py-1.5 text-[11px] font-semibold transition-colors",
                  dirValue === "desc"
                    ? "bg-[var(--ds-surface-elevated)] text-[var(--ds-text)] shadow-sm"
                    : "text-[var(--ds-text-secondary)] hover:text-[var(--ds-text)]"
                )}
              >
                ↓
              </button>
              <button
                id="dir-asc"
                type="button"
                aria-pressed={dirValue === "asc"}
                aria-label="Sort ascending"
                onClick={() => set({ dir: "asc" })}
                className={cn(
                  "rounded-[9px] px-2 py-1.5 text-[11px] font-semibold transition-colors",
                  dirValue === "asc"
                    ? "bg-[var(--ds-surface-elevated)] text-[var(--ds-text)] shadow-sm"
                    : "text-[var(--ds-text-secondary)] hover:text-[var(--ds-text)]"
                )}
              >
                ↑
              </button>
            </div>
          </div>

          {/* Mobile: open the filter sheet */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold text-[var(--ds-text)] transition-colors hover:bg-[var(--ds-gold-50)] md:hidden"
            style={{ borderColor: "var(--ds-border-strong)" }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Filters
            {chips.length > 0 && (
              <span
                className="ds-mono rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: "var(--ds-gold-100)", color: "var(--ds-gold-700)" }}
              >
                {chips.length}
              </span>
            )}
          </button>

          {/* Desktop: open the advanced drawer */}
          <button
            type="button"
            onClick={() => setAdvancedOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={advancedOpen}
            className="hidden h-10 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] md:inline-flex"
            style={{ borderColor: "var(--ds-border)" }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Advanced
            {advancedCount > 0 && (
              <span
                className="ds-mono rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: "var(--ds-gold-100)", color: "var(--ds-gold-700)" }}
              >
                {advancedCount}
              </span>
            )}
          </button>
        </div>

        {/* Scope distinction */}
        <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--ds-text-muted)]">
          Filters shape the results list. Only the Symbol also changes the scan target.
        </p>

        {/* Active filters */}
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-0.5 text-[10.5px] font-medium"
                style={{
                  borderColor: "var(--ds-border)",
                  background: "var(--ds-surface-elevated)",
                  color: "var(--ds-text-secondary)",
                }}
              >
                <span className="max-w-[180px] truncate">{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.clear}
                  aria-label={`Remove filter: ${chip.label}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-gold-100)] hover:text-[var(--ds-text)]"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Desktop drawer backdrop */}
      {advancedOpen && (
        <div
          className="fixed inset-0 z-40 hidden md:block"
          style={{ background: "rgb(41 39 32 / 0.36)" }}
          onClick={() => setAdvancedOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
