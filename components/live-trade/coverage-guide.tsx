"use client";

import { ChevronDown, Layers3 } from "lucide-react";
import { CoverageBadge } from "./coverage-badge";
import {
  COVERAGE_META,
  COVERAGE_ORDER,
} from "@/lib/live-trade/ui";

export function CoverageGuide() {
  return (
    <details className="group overflow-hidden rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] shadow-[var(--ds-shadow-card)]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-xs font-bold text-[var(--ds-text)] marker:content-none">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ds-gold-50)] text-[var(--ds-gold-700)]">
          <Layers3 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="flex-1">Coverage &amp; freshness guide</span>
        <ChevronDown
          className="h-4 w-4 text-[var(--ds-text-muted)] transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-3 border-t border-[var(--ds-border)] px-4 py-3">
        <p className="text-[11px] leading-relaxed text-[var(--ds-text-secondary)]">
          Quote freshness, scanner coverage freshness and each zone&apos;s
          formation date measure different things. A live quote does not make an
          old zone new, and scanner coverage does not make a quote current.
        </p>

        <ul className="space-y-2.5">
          {COVERAGE_ORDER.map((coverage) => (
            <li key={coverage} className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
              <span className="shrink-0">
                <CoverageBadge coverage={coverage} />
              </span>
              <p className="text-[11px] leading-relaxed text-[var(--ds-text-muted)]">
                {COVERAGE_META[coverage].description}
              </p>
            </li>
          ))}
        </ul>

        <p className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-gold-50)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--ds-text-secondary)]">
          <span className="font-bold text-[var(--ds-gold-700)]">AVAILABLE</span> means a
          completed scanner run covers the instrument. It does not prove that
          every displayed zone was re-detected in the latest scan: zones are not
          rewritten on re-detection and keep their original formation date.
          Freshness uses the latest completed scan covering the instrument, not
          the zone&apos;s creation date.
        </p>
      </div>
    </details>
  );
}
