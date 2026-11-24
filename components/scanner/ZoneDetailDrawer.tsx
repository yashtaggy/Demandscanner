"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Zone } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

interface ZoneDetailDrawerProps {
  zone: Zone | null;
  onClose: () => void;
  /** Light presentation tokens for the Overview design system. */
  variant?: "dark" | "light";
}

const SIDE_COLOR = {
  DEMAND: { border: "border-emerald-500/30", bg: "bg-emerald-500/8", text: "text-emerald-400", dot: "bg-emerald-400" },
  SUPPLY: { border: "border-rose-500/30",    bg: "bg-rose-500/8",    text: "text-rose-400",    dot: "bg-rose-400" },
};

const SIDE_LIGHT = {
  DEMAND: {
    borderColor: "color-mix(in srgb, var(--ds-positive) 28%, var(--ds-border))",
    background: "var(--ds-positive-soft)",
    text: "text-[var(--ds-positive)]",
    dot: "bg-[var(--ds-positive)]",
  },
  SUPPLY: {
    borderColor: "color-mix(in srgb, var(--ds-negative) 28%, var(--ds-border))",
    background: "var(--ds-negative-soft)",
    text: "text-[var(--ds-negative)]",
    dot: "bg-[var(--ds-negative)]",
  },
};

const LIFECYCLE_COLOR: Record<string, string> = {
  CONFIRMED_FRESH: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  TOUCHED_ONCE:    "text-amber-400   bg-amber-400/10   border-amber-400/30",
  RETESTED:        "text-orange-400  bg-orange-400/10  border-orange-400/30",
  BROKEN:          "text-rose-400    bg-rose-400/10    border-rose-400/30",
};

const LIFECYCLE_LIGHT: Record<string, string> = {
  CONFIRMED_FRESH: "text-[var(--ds-positive)] bg-[var(--ds-positive-soft)]",
  TOUCHED_ONCE:    "text-[var(--ds-warning)] bg-[var(--ds-gold-50)]",
  RETESTED:        "text-[var(--ds-gold-700)] bg-[var(--ds-gold-100)]",
  BROKEN:          "text-[var(--ds-negative)] bg-[var(--ds-negative-soft)]",
};

const LIFECYCLE_LABEL: Record<string, string> = {
  CONFIRMED_FRESH: "Fresh", TOUCHED_ONCE: "Tested", RETESTED: "Retested", BROKEN: "Broken",
};

function fmt(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function ZoneDetailDrawer({ zone, onClose, variant = "dark" }: ZoneDetailDrawerProps) {
  const light = variant === "light";
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!zone) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [zone]);

  if (!zone) return null;

  const darkSide = SIDE_COLOR[zone.side] ?? SIDE_COLOR.DEMAND;
  const lightSide = SIDE_LIGHT[zone.side] ?? SIDE_LIGHT.DEMAND;
  const lc = light
    ? (LIFECYCLE_LIGHT[zone.lifecycleState] ?? "text-[var(--ds-text-secondary)] bg-[var(--ds-surface-subtle)]")
    : (LIFECYCLE_COLOR[zone.lifecycleState] ?? "text-slate-400");
  const lcLabel = LIFECYCLE_LABEL[zone.lifecycleState] ?? zone.lifecycleState;
  const compositeScore = zone.compositeScore ?? zone.score;
  const incomplete = zone.scoreComponents?.isComplete === false;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 backdrop-blur-sm animate-in fade-in duration-200",
          light ? "bg-black/35" : "bg-slate-950/60"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer: full-screen sheet on mobile, fixed-width overlay on larger screens */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-drawer-title"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l shadow-2xl animate-in slide-in-from-right duration-250 sm:w-[460px] sm:max-w-[96vw]",
          light ? "bg-[var(--ds-surface)]" : "bg-slate-900 border-slate-700/60"
        )}
        style={light ? { borderColor: "var(--ds-border)", boxShadow: "var(--ds-shadow-float)" } : undefined}
      >
        {/* Identity header — symbol, side, and the three price levels that matter first */}
        <div
          className={cn("border-b px-5 py-4", !light && `${darkSide.border} ${darkSide.bg}`)}
          style={light ? { borderColor: lightSide.borderColor, background: lightSide.background } : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", light ? lightSide.dot : darkSide.dot)}
                  aria-hidden="true"
                />
                <h2
                  id="zone-drawer-title"
                  className={cn("truncate text-base font-bold", light ? lightSide.text : darkSide.text)}
                >
                  {zone.symbol ?? `ID #${zone.instrumentId}`}
                </h2>
                <span
                  className={cn(
                    "ds-mono text-xs",
                    light ? "text-[var(--ds-text-muted)]" : "text-slate-500"
                  )}
                >
                  {zone.timeframe}
                </span>
              </div>
              <p
                className={cn(
                  "text-xs",
                  light ? "text-[var(--ds-text-secondary)]" : "text-slate-500"
                )}
              >
                {zone.pattern} · {zone.side === "DEMAND" ? "Demand Zone" : "Supply Zone"}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              id="zone-drawer-close"
              onClick={onClose}
              className={cn(
                "shrink-0 rounded-md p-1 transition-colors",
                light
                  ? "text-[var(--ds-text-muted)] hover:bg-[var(--ds-surface)] hover:text-[var(--ds-text)]"
                  : "text-slate-500 hover:bg-slate-700/50 hover:text-slate-200"
              )}
              aria-label="Close zone details"
            >
              <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <KeyLevel label="Proximal" value={`₹${fmt(zone.proximal)}`} light={light} strong />
            <KeyLevel label="Distal" value={`₹${fmt(zone.distal)}`} light={light} />
            <KeyLevel label="Width" value={`₹${fmt(zone.zoneHigh - zone.zoneLow)}`} light={light} />
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Score cards */}
          <div className="grid grid-cols-3 gap-2">
            <ScoreCard
              label="Composite"
              value={compositeScore}
              color={light ? "text-[var(--ds-gold-700)]" : "text-violet-400"}
              incomplete={incomplete}
              light={light}
            />
            <ScoreCard
              label="Formation"
              value={zone.score}
              color={light ? "text-[var(--ds-info)]" : "text-indigo-400"}
              light={light}
            />
            <div
              className={cn(
                "rounded-lg border p-3 text-center",
                light ? "border-[var(--ds-border)] bg-[var(--ds-surface-subtle)]" : "bg-slate-800/60 border-slate-700/40"
              )}
            >
              <p
                className={cn(
                  "mb-0.5 text-xs",
                  light ? "text-[var(--ds-text-muted)]" : "text-slate-500"
                )}
              >
                Status
              </p>
              <span
                className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", lc)}
                style={light ? { borderColor: "color-mix(in srgb, currentColor 30%, transparent)" } : undefined}
              >
                {lcLabel}
              </span>
              {zone.touchCount > 0 && (
                <p
                  className={cn(
                    "mt-1 text-xs",
                    light ? "text-[var(--ds-text-muted)]" : "text-slate-600"
                  )}
                >
                  {zone.touchCount}× touched
                </p>
              )}
            </div>
          </div>

          {/* Incomplete score warning */}
          {incomplete && zone.scoreComponents && (
            <div
              className={cn(
                "rounded-lg border p-3 text-xs",
                light
                  ? "border-[var(--ds-border)] bg-[var(--ds-gold-50)] text-[var(--ds-warning)]"
                  : "border-amber-500/20 bg-amber-500/5 text-amber-400"
              )}
            >
              Composite score is incomplete. Missing:{" "}
              {zone.scoreComponents.missingComponents.join(", ")}
            </div>
          )}

          {/* Score component breakdown */}
          {zone.scoreComponents && (
            <Section title="Score Breakdown (v1 — not empirically optimal)" light={light}>
              <ComponentBar label="TF Quality"        value={zone.scoreComponents.timeframeQuality}  max={20} light={light} />
              <ComponentBar label="Leg-out Body"      value={zone.scoreComponents.legOutBodyRatio}   max={15} light={light} />
              <ComponentBar label="Base Tightness"    value={zone.scoreComponents.baseTightness}     max={15} light={light} />
              <ComponentBar label="Volume Surge"      value={zone.scoreComponents.volumeSurge}       max={10} light={light} />
              <ComponentBar label="Freshness"         value={zone.scoreComponents.freshness}         max={10} light={light} />
              <ComponentBar label="Zone Age"          value={zone.scoreComponents.zoneAge}           max={5}  light={light} />
              <ComponentBar
                label="Dist. from Price"
                value={zone.scoreComponents.distanceFromPrice ?? 0}
                max={5}
                note={zone.scoreComponents.distanceFromPrice == null ? "unavailable" : undefined}
                light={light}
              />
              <ComponentBar label="Confluence"        value={zone.scoreComponents.confluenceScore}   max={10} light={light} />
              <ComponentBar label="Opposing Room"     value={zone.scoreComponents.opposingZoneRoom}  max={5}  light={light} />
              <ComponentBar label="Data Quality"      value={zone.scoreComponents.dataQuality}       max={5}  light={light} />
            </Section>
          )}

          {/* Confluence + risk */}
          {(zone.confluenceScore || zone.oppositionRisk) && (
            <Section title="Confluence & Risk" light={light}>
              {zone.confluenceScore != null && (
                <Row label="Confluence Score" value={`${zone.confluenceScore} / 100`} light={light} />
              )}
              {zone.oppositionRisk != null && (
                <Row label="Opposition Risk" value={`${zone.oppositionRisk} / 100`} light={light} />
              )}
              {zone.distancePct != null && (
                <Row label="Distance from Price" value={`${zone.distancePct.toFixed(2)}%`} highlight light={light} />
              )}
            </Section>
          )}

          {/* Price levels */}
          <Section title="Price Levels" light={light}>
            <Row label="Proximal" value={`₹${fmt(zone.proximal)}`} highlight light={light} />
            <Row label="Distal"   value={`₹${fmt(zone.distal)}`}   light={light} />
            <Row label="Zone High" value={`₹${fmt(zone.zoneHigh)}`} light={light} />
            <Row label="Zone Low"  value={`₹${fmt(zone.zoneLow)}`}  light={light} />
            <Row label="Zone Width" value={`₹${fmt(zone.zoneHigh - zone.zoneLow)}`} light={light} />
          </Section>

          {/* Timeline */}
          <Section title="Formation Timeline" light={light}>
            <Row label="Leg-In"     value={fmtDate(zone.legInTs)} light={light} />
            <Row label="Base Start" value={fmtDate(zone.baseStart)} light={light} />
            <Row label="Base End"   value={fmtDate(zone.baseEnd)} light={light} />
            <Row label="Leg-Out"    value={fmtDate(zone.legOutTs)} light={light} />
            {zone.lastTouchTs && (
              <Row label="Last Touch" value={fmtDate(zone.lastTouchTs)} light={light} />
            )}
          </Section>

          {/* Data quality */}
          {zone.dataQualityScore != null && zone.dataQualityScore < 5 && (
            <div
              className={cn(
                "rounded-lg border p-3",
                light
                  ? "border-[var(--ds-border)] bg-[var(--ds-gold-50)]"
                  : "border-amber-500/20 bg-amber-500/5"
              )}
            >
              <p
                className={cn(
                  "mb-1 text-xs font-semibold",
                  light ? "text-[var(--ds-warning)]" : "text-amber-400"
                )}
              >
                Data Quality Warning
              </p>
              <p
                className={cn(
                  "text-xs",
                  light ? "text-[var(--ds-text-secondary)]" : "text-slate-400"
                )}
              >
                Quality score: {zone.dataQualityScore}/5. Some candles may be missing or incomplete
                for this timeframe. Historical results may differ from full-data analysis.
              </p>
            </div>
          )}

          {/* Meta */}
          <Section title="Meta" light={light}>
            <Row label="Pattern"   value={zone.pattern} light={light} />
            <Row label="Timeframe" value={zone.timeframe} light={light} />
            <Row label="Config v"  value={String(zone.configVersion)} light={light} />
            <Row label="Zone ID"   value={zone.zoneId.slice(0, 12) + "…"} light={light} />
          </Section>
        </div>
      </aside>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function KeyLevel({
  label,
  value,
  light,
  strong,
}: {
  label: string;
  value: string;
  light: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-1.5",
        light ? "border-[var(--ds-border)] bg-[var(--ds-surface)]" : "border-slate-700/40 bg-slate-900/40"
      )}
    >
      <p
        className={cn(
          "text-[9.5px] font-semibold uppercase tracking-[0.1em]",
          light ? "text-[var(--ds-text-muted)]" : "text-slate-500"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "ds-mono text-[12.5px] font-semibold tabular-nums",
          strong
            ? light
              ? "text-[var(--ds-gold-700)]"
              : "text-indigo-300"
            : light
              ? "text-[var(--ds-text)]"
              : "text-slate-200"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  color,
  incomplete,
  light,
}: {
  label: string;
  value: number;
  color: string;
  incomplete?: boolean;
  light: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-center",
        light ? "border-[var(--ds-border)] bg-[var(--ds-surface-subtle)]" : "bg-slate-800/60 border-slate-700/40"
      )}
    >
      <p className={cn("mb-0.5 text-xs", light ? "text-[var(--ds-text-muted)]" : "text-slate-500")}>
        {label}
      </p>
      <p className={cn("ds-mono text-2xl font-semibold tabular-nums", color)}>
        {value}
        {incomplete && (
          <span className={cn("text-base", light ? "text-[var(--ds-warning)]" : "text-amber-400")}>*</span>
        )}
      </p>
      <p className={cn("text-xs", light ? "text-[var(--ds-text-muted)]" : "text-slate-600")}>/100</p>
    </div>
  );
}

function ComponentBar({
  label,
  value,
  max,
  note,
  light,
}: {
  label: string;
  value: number;
  max: number;
  note?: string;
  light: boolean;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color =
    pct >= 70
      ? light ? "bg-[var(--ds-positive)]" : "bg-emerald-500"
      : pct >= 40
        ? light ? "bg-[var(--ds-gold-500)]" : "bg-amber-500"
        : light ? "bg-[var(--ds-border-strong)]" : "bg-slate-500";
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b px-3 py-1.5 last:border-0",
        light ? "border-[var(--ds-border)]/60" : "border-slate-700/30"
      )}
    >
      <span
        className={cn(
          "w-32 shrink-0 text-xs",
          light ? "text-[var(--ds-text-muted)]" : "text-slate-500"
        )}
      >
        {label}
      </span>
      <div
        className={cn(
          "h-1 flex-1 overflow-hidden rounded-full",
          light ? "bg-[var(--ds-surface-subtle)]" : "bg-slate-700/60"
        )}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={cn(
          "ds-mono w-12 text-right text-[11.5px] tabular-nums",
          light ? "text-[var(--ds-text-secondary)]" : "text-slate-400"
        )}
      >
        {note ? (
          <span className={light ? "text-[var(--ds-warning)]" : "text-amber-500/60"}>{note}</span>
        ) : (
          `${value}/${max}`
        )}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  light,
}: {
  title: string;
  children: React.ReactNode;
  light: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p
        className={cn(
          "text-[10.5px] font-semibold uppercase tracking-[0.1em]",
          light ? "text-[var(--ds-text-muted)]" : "text-slate-500"
        )}
      >
        {title}
      </p>
      <div
        className={cn(
          "divide-y rounded-xl border",
          light
            ? "divide-[var(--ds-border)]/60 border-[var(--ds-border)] bg-[var(--ds-surface)]"
            : "divide-slate-700/30 border-slate-700/40 bg-slate-800/30"
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight = false,
  light,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  light: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className={cn("text-[11.5px]", light ? "text-[var(--ds-text-muted)]" : "text-slate-500")}>
        {label}
      </span>
      <span
        className={cn(
          "ds-mono text-right text-[11.5px] font-medium tabular-nums",
          highlight
            ? light
              ? "text-[var(--ds-gold-700)]"
              : "text-indigo-300"
            : light
              ? "text-[var(--ds-text)]"
              : "text-slate-300"
        )}
      >
        {value}
      </span>
    </div>
  );
}
