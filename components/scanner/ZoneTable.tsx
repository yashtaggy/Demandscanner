"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Zone } from "@/lib/scanner/types";
import { ZoneDetailDrawer } from "./ZoneDetailDrawer";

export type ZoneSortKey = "score" | "distance_pct" | "formation_ts";

interface ZoneTableProps {
  zones: Zone[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect?: (zone: Zone) => void;
  /** Omitted on /scanner so the original dark styling is unchanged. */
  variant?: "dark" | "light";
  /** Premium presentation used by the Scanner page results workspace. */
  enhanced?: boolean;
  sortKey?: ZoneSortKey;
  sortDir?: "asc" | "desc";
  onSortChange?: (key: ZoneSortKey) => void;
}

const ENHANCED_COLUMNS: Array<{
  key: string;
  label: string;
  short?: string;
  align: "left" | "right";
  sort?: ZoneSortKey;
  title?: string;
  className?: string;
}> = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "timeframe", label: "Timeframe", short: "TF", align: "left" },
  { key: "pattern", label: "Pattern", align: "left" },
  { key: "proximal", label: "Proximal", align: "right" },
  { key: "status", label: "Status", align: "left" },
  {
    key: "distance",
    label: "Distance",
    short: "Dist %",
    align: "right",
    sort: "distance_pct",
    title: "Distance from current price",
  },
  {
    key: "confluence",
    label: "Confluence",
    short: "Conf.",
    align: "right",
    title: "Higher-timeframe confluence score",
  },
  { key: "formation", label: "Formation", align: "right", sort: "formation_ts" },
  {
    key: "score",
    label: "Score",
    align: "right",
    sort: "score",
    title:
      "Sorted by formation score. Composite-score sorting is unavailable until composite scores are populated.",
  },
];

const SIDE_STYLE = {
  DEMAND: { pill: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30", dot: "bg-emerald-400" },
  SUPPLY: { pill: "text-rose-400 bg-rose-400/10 border-rose-400/30", dot: "bg-rose-400" },
};

const LC_STYLE: Record<string, string> = {
  CONFIRMED_FRESH: "text-emerald-400 bg-emerald-400/10 border-emerald-400/25",
  TOUCHED_ONCE:    "text-amber-400 bg-amber-400/10 border-amber-400/25",
  RETESTED:        "text-orange-400 bg-orange-400/10 border-orange-400/25",
  BROKEN:          "text-rose-500/70 bg-rose-500/5 border-rose-500/20",
};

const LIGHT_SIDE: Record<"DEMAND" | "SUPPLY", { color: string; soft: string }> = {
  DEMAND: { color: "var(--ds-positive)", soft: "var(--ds-positive-soft)" },
  SUPPLY: { color: "var(--ds-negative)", soft: "var(--ds-negative-soft)" },
};

const LIGHT_LC: Record<string, { color: string; soft: string }> = {
  CONFIRMED_FRESH: { color: "var(--ds-positive)", soft: "var(--ds-positive-soft)" },
  TOUCHED_ONCE:    { color: "var(--ds-warning)",  soft: "var(--ds-warning-soft)" },
  RETESTED:        { color: "var(--ds-gold-700)", soft: "var(--ds-gold-100)" },
  BROKEN:          { color: "var(--ds-negative)", soft: "var(--ds-negative-soft)" },
};

const LC_LABEL: Record<string, string> = {
  CONFIRMED_FRESH: "Fresh",
  TOUCHED_ONCE:    "Tested ×1",
  RETESTED:        "Retested",
  BROKEN:          "Broken",
};

function fmtPrice(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function ScoreBar({
  score,
  color = "bg-indigo-500",
  light,
  enhanced,
}: {
  score: number;
  color?: string;
  light?: boolean;
  enhanced?: boolean;
}) {
  const autoColor =
    score >= 70 ? "bg-emerald-500" : score >= 45 ? "bg-amber-500" : "bg-rose-500";
  const lightAutoColor =
    score >= 70 ? "var(--ds-positive)" : score >= 45 ? "var(--ds-warning)" : "var(--ds-negative)";
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`flex-1 h-1.5 rounded-full overflow-hidden ${light ? "" : "bg-slate-700/60"}`}
        style={light ? { background: "var(--ds-surface-subtle)" } : undefined}
      >
        <div
          className={`h-full rounded-full ${light ? "" : color === "auto" ? autoColor : color} transition-all`}
          style={{
            width: `${score}%`,
            ...(light ? { background: color === "auto" ? lightAutoColor : color } : {}),
          }}
        />
      </div>
      <span
        className={`tabular-nums text-right ${
          enhanced ? "ds-mono w-8 text-[11.5px] font-semibold" : "w-5 text-xs"
        } ${light ? "text-[var(--ds-text-muted)]" : "text-slate-400"}`}
      >
        {score}
      </span>
    </div>
  );
}

function DataQualityBadge({ score, light }: { score: number | undefined; light?: boolean }) {
  if (score == null) return null;
  if (score >= 5) return null; // full quality — no warning needed
  if (light) {
    return (
      <span
        title={`Data quality: ${score}/5`}
        className="text-xs cursor-help"
        style={{ color: score >= 3 ? "var(--ds-warning)" : "var(--ds-negative)" }}
      >
        ⚠
      </span>
    );
  }
  const color = score >= 3 ? "text-amber-400" : "text-rose-400";
  return (
    <span title={`Data quality: ${score}/5`} className={`text-xs ${color} cursor-help`}>⚠</span>
  );
}

function DistanceBadge({ pct, light }: { pct: number | null | undefined; light?: boolean }) {
  if (pct == null) {
    return <span className={light ? "text-[var(--ds-text-muted)]" : "text-slate-600"}>—</span>;
  }
  if (light) {
    const color =
      pct < 1 ? "var(--ds-positive)" : pct < 3 ? "var(--ds-warning)" : "var(--ds-text-muted)";
    return <span className="tabular-nums" style={{ color }}>{pct.toFixed(1)}%</span>;
  }
  const color = pct < 1 ? "text-emerald-400" : pct < 3 ? "text-amber-400" : "text-slate-400";
  return <span className={`tabular-nums ${color}`}>{pct.toFixed(1)}%</span>;
}

function ConfluenceBadge({ score, light }: { score: number | undefined; light?: boolean }) {
  if (!score) {
    return <span className={light ? "text-[var(--ds-text-muted)]" : "text-slate-600"}>—</span>;
  }
  if (light) {
    return (
      <span
        className="tabular-nums"
        style={{ color: score >= 20 ? "var(--ds-info)" : "var(--ds-text-secondary)" }}
      >
        {score}
      </span>
    );
  }
  const color = score >= 20 ? "text-cyan-400" : "text-slate-400";
  return <span className={`tabular-nums ${color}`}>{score}</span>;
}

export function ZoneTable({
  zones,
  loading,
  error,
  onRetry,
  onSelect,
  variant = "dark",
  enhanced = false,
  sortKey,
  sortDir = "desc",
  onSortChange,
}: ZoneTableProps) {
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const light = variant === "light";

  function handleSelect(zone: Zone) {
    if (onSelect) onSelect(zone);
    else setSelectedZone(zone);
  }

  if (error) {
    if (light) {
      return (
        <div
          className="rounded-lg border p-4 flex items-center justify-between gap-3"
          style={{ borderColor: "var(--ds-negative)", background: "var(--ds-negative-soft)" }}
        >
          <p className="text-xs" style={{ color: "var(--ds-negative)" }}>{error}</p>
          <button
            onClick={onRetry}
            className="text-xs underline underline-offset-2"
            style={{ color: "var(--ds-negative)" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 flex items-center justify-between gap-3">
        <p className="text-xs text-rose-400">{error}</p>
        <button onClick={onRetry} className="text-xs text-rose-400 hover:text-rose-300 underline">Retry</button>
      </div>
    );
  }

  if (loading && zones.length === 0) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`h-10 rounded-lg animate-pulse ${light ? "bg-[var(--ds-surface-subtle)]" : "bg-slate-800/40"}`}
            style={{ opacity: 1 - i * 0.15 }}
          />
        ))}
      </div>
    );
  }

  if (zones.length === 0) {
    if (light) {
      return (
        <div
          className="rounded-lg border p-6 text-center"
          style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface-elevated)" }}
        >
          <p className="text-sm text-[var(--ds-text-secondary)]">No zones found</p>
          <p className="mt-1 text-xs text-[var(--ds-text-muted)]">Run a scan or adjust your filters.</p>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-slate-700/40 bg-slate-800/20 p-6 text-center">
        <p className="text-sm text-slate-500">No zones found</p>
        <p className="text-xs text-slate-600 mt-1">Run a scan or adjust your filters.</p>
      </div>
    );
  }

  if (enhanced) {
    return (
      <>
        <div
          role="region"
          aria-label="Zone results"
          tabIndex={0}
          className="overflow-auto rounded-2xl border lg:max-h-[calc(100vh-16rem)]"
          style={{
            borderColor: "var(--ds-border)",
            background: "var(--ds-surface)",
            boxShadow: "var(--ds-shadow-card)",
          }}
        >
          <table className="w-full min-w-[900px] border-collapse text-[12px]" id="zone-table">
            <caption className="sr-only">
              Supply and demand zones. Each row is keyboard-focusable; press Enter to open
              zone details.
            </caption>
            <thead className="sticky top-0 z-20">
              <tr style={{ background: "var(--ds-surface-elevated)" }}>
                {ENHANCED_COLUMNS.map((col) => {
                  const isActive = !!col.sort && sortKey === col.sort;
                  const ariaSort = col.sort
                    ? isActive
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                    : undefined;
                  const alignClass = col.align === "right" ? "text-right" : "text-left";
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={ariaSort}
                      title={col.title}
                      className={`whitespace-nowrap border-b px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ds-text-muted)] ${
                        col.key === "symbol"
                          ? "max-md:sticky max-md:left-0 max-md:z-30"
                          : ""
                      } ${alignClass}`}
                      style={{
                        borderColor: "var(--ds-border)",
                        background:
                          col.key === "symbol" ? "var(--ds-surface-elevated)" : undefined,
                      }}
                    >
                      {col.sort && onSortChange ? (
                        <button
                          type="button"
                          onClick={() => onSortChange(col.sort as ZoneSortKey)}
                          className={`inline-flex items-center gap-1 rounded-md transition-colors hover:text-[var(--ds-text)] ${
                            col.align === "right" ? "w-full justify-end" : ""
                          }`}
                          title={col.title}
                        >
                          <span className="lg:hidden">{col.short ?? col.label}</span>
                          <span className="hidden lg:inline">{col.label}</span>
                          {isActive ? (
                            sortDir === "asc" ? (
                              <ArrowUp
                                className="h-3 w-3 text-[var(--ds-gold-700)]"
                                strokeWidth={2.5}
                                aria-hidden="true"
                              />
                            ) : (
                              <ArrowDown
                                className="h-3 w-3 text-[var(--ds-gold-700)]"
                                strokeWidth={2.5}
                                aria-hidden="true"
                              />
                            )
                          ) : (
                            <ArrowUpDown
                              className="h-3 w-3 opacity-50"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      ) : (
                        <>
                          <span className="lg:hidden">{col.short ?? col.label}</span>
                          <span className="hidden lg:inline">{col.label}</span>
                        </>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => {
                const sideKey = zone.side === "SUPPLY" ? "SUPPLY" : "DEMAND";
                const ls = LIGHT_SIDE[sideKey];
                const llc =
                  LIGHT_LC[zone.lifecycleState] ?? {
                    color: "var(--ds-text-secondary)",
                    soft: "var(--ds-surface-subtle)",
                  };
                const lcLabel = LC_LABEL[zone.lifecycleState] ?? zone.lifecycleState;
                const compositeScore = zone.compositeScore ?? zone.score;
                const symbolLabel = zone.symbol ?? String(zone.instrumentId);
                return (
                  <tr
                    key={zone.zoneId}
                    id={`zone-row-${zone.zoneId}`}
                    tabIndex={0}
                    aria-label={`View details for ${symbolLabel}, ${zone.timeframe} ${zone.pattern} zone`}
                    className="group cursor-pointer border-b border-[var(--ds-border)]/60 transition-colors last:border-b-0 hover:bg-[var(--ds-gold-50)] focus-visible:bg-[var(--ds-gold-50)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ds-gold-700)]"
                    onClick={() => handleSelect(zone)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelect(zone);
                      }
                    }}
                  >
                    <td
                      className="max-md:sticky max-md:left-0 max-md:z-10 px-3 py-2.5 transition-colors group-hover:bg-[var(--ds-gold-50)] group-focus-visible:bg-[var(--ds-gold-50)]"
                      style={{ background: "var(--ds-surface)" }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: ls.color }}
                          aria-hidden="true"
                        />
                        <span className="ds-mono text-[12px] font-semibold tracking-wide text-[var(--ds-text)]">
                          {symbolLabel}
                        </span>
                        <DataQualityBadge score={zone.dataQualityScore} light />
                      </div>
                    </td>
                    <td className="ds-mono px-3 py-2.5 text-[11.5px] text-[var(--ds-text-muted)]">
                      {zone.timeframe}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ color: ls.color, background: ls.soft, borderColor: ls.color }}
                      >
                        {zone.pattern}
                      </span>
                    </td>
                    <td className="ds-mono px-3 py-2.5 text-right text-[12px] text-[var(--ds-text-secondary)] tabular-nums">
                      ₹{fmtPrice(zone.proximal)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ color: llc.color, background: llc.soft, borderColor: llc.color }}
                      >
                        {lcLabel}
                      </span>
                    </td>
                    <td className="ds-mono px-3 py-2.5 text-right text-[12px] tabular-nums">
                      <DistanceBadge pct={zone.distancePct} light />
                    </td>
                    <td className="ds-mono px-3 py-2.5 text-right text-[12px] tabular-nums">
                      <ConfluenceBadge score={zone.confluenceScore} light />
                    </td>
                    <td className="ds-mono px-3 py-2.5 text-right text-[11.5px] text-[var(--ds-text-muted)] tabular-nums">
                      {fmtDate(zone.formationTs)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="ml-auto w-[104px]">
                        <ScoreBar score={compositeScore} color="auto" light enhanced />
                      </div>
                      {zone.compositeScore != null && zone.score !== zone.compositeScore && (
                        <span className="ds-mono block text-[10px] text-[var(--ds-text-muted)]">
                          F:{zone.score}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!onSelect && (
          <ZoneDetailDrawer
            zone={selectedZone}
            onClose={() => setSelectedZone(null)}
            variant={light ? "light" : "dark"}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className={`overflow-hidden rounded-lg border overflow-x-auto ${light ? "" : "border-slate-700/40"}`}
        style={light ? { borderColor: "var(--ds-border)", background: "var(--ds-surface)" } : undefined}
      >
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr
              className={`border-b ${light ? "" : "border-slate-700/40 bg-slate-800/40"}`}
              style={light ? { borderColor: "var(--ds-border)", background: "var(--ds-surface-elevated)" } : undefined}
            >
              <th className={`px-3 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>Symbol</th>
              <th className={`px-2 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>TF</th>
              <th className={`px-2 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>Pattern</th>
              <th className={`px-2 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>Proximal</th>
              <th className={`px-2 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>Status</th>
              <th className={`px-2 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`} title="Distance from current price">Dist %</th>
              <th className={`px-2 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`} title="Higher-timeframe confluence score">Conf.</th>
              <th className={`px-2 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>Formation</th>
              <th className={`px-3 py-2 text-left font-medium ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>Score</th>
            </tr>
          </thead>
          <tbody
            className={light ? "[&>tr+tr]:border-t [&>tr+tr]:border-[var(--ds-border)]" : "divide-y divide-slate-700/20"}
          >
            {zones.map((zone) => {
              const sideKey = zone.side === "SUPPLY" ? "SUPPLY" : "DEMAND";
              const s  = SIDE_STYLE[sideKey];
              const ls = LIGHT_SIDE[sideKey];
              const lc = LC_STYLE[zone.lifecycleState]  ?? "text-slate-400";
              const llc = LIGHT_LC[zone.lifecycleState] ?? { color: "var(--ds-text-secondary)", soft: "var(--ds-surface-subtle)" };
              const lcLabel = LC_LABEL[zone.lifecycleState] ?? zone.lifecycleState;
              const compositeScore = zone.compositeScore ?? zone.score;
              return (
                <tr key={zone.zoneId} id={`zone-row-${zone.zoneId}`}
                  className={`${light ? "cursor-pointer transition-colors hover:bg-[var(--ds-gold-50)]" : "hover:bg-slate-800/40 cursor-pointer transition-colors"} group`}
                  onClick={() => handleSelect(zone)}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {light ? (
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ background: ls.color }}
                        />
                      ) : (
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.dot}`} />
                      )}
                      <span className={`font-medium transition-colors ${light ? "text-[var(--ds-text)]" : "text-slate-200 group-hover:text-white"}`}>
                        {zone.symbol ?? zone.instrumentId}
                      </span>
                      <DataQualityBadge score={zone.dataQualityScore} light={light} />
                    </div>
                  </td>
                  <td className={`px-2 py-2.5 font-mono ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>{zone.timeframe}</td>
                  <td className="px-2 py-2.5">
                    {light ? (
                      <span
                        className="inline-flex px-1.5 py-0.5 rounded border text-xs font-medium"
                        style={{ color: ls.color, background: ls.soft, borderColor: ls.color }}
                      >
                        {zone.pattern}
                      </span>
                    ) : (
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-xs font-medium ${s.pill}`}>
                        {zone.pattern}
                      </span>
                    )}
                  </td>
                  <td className={`px-2 py-2.5 tabular-nums ${light ? "text-[var(--ds-text-secondary)]" : "text-slate-300"}`}>₹{fmtPrice(zone.proximal)}</td>
                  <td className="px-2 py-2.5">
                    {light ? (
                      <span
                        className="inline-flex px-1.5 py-0.5 rounded border text-xs font-medium"
                        style={{ color: llc.color, background: llc.soft, borderColor: llc.color }}
                      >
                        {lcLabel}
                      </span>
                    ) : (
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-xs font-medium ${lc}`}>
                        {lcLabel}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <DistanceBadge pct={zone.distancePct} light={light} />
                  </td>
                  <td className="px-2 py-2.5">
                    <ConfluenceBadge score={zone.confluenceScore} light={light} />
                  </td>
                  <td className={`px-2 py-2.5 ${light ? "text-[var(--ds-text-muted)]" : "text-slate-500"}`}>
                    {fmtDate(zone.formationTs)}
                  </td>
                  <td className="px-3 py-2.5 w-28">
                    <ScoreBar score={compositeScore} color="auto" light={light} />
                    {zone.compositeScore != null && zone.score !== zone.compositeScore && (
                      <span className={`text-xs tabular-nums ${light ? "text-[var(--ds-text-muted)]" : "text-slate-600"}`}>F:{zone.score}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!onSelect && (
        <ZoneDetailDrawer
          zone={selectedZone}
          onClose={() => setSelectedZone(null)}
          variant={light ? "light" : "dark"}
        />
      )}
    </>
  );
}
