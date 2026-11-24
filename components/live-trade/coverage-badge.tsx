"use client";

import { Badge } from "@/components/ui/badge";
import type { LiveTradeZoneCoverage } from "@/lib/live-trade/constants";
import { COVERAGE_META } from "@/lib/live-trade/ui";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  success:
    "border-[var(--ds-positive)]/25 bg-[var(--ds-positive-soft)] text-[var(--ds-positive)]",
  danger:
    "border-[var(--ds-negative)]/25 bg-[var(--ds-negative-soft)] text-[var(--ds-negative)]",
  warning:
    "border-[var(--ds-warning)]/25 bg-[var(--ds-warning-soft)] text-[var(--ds-warning)]",
  info: "border-[var(--ds-info)]/25 bg-[var(--ds-info-soft)] text-[var(--ds-info)]",
  neutral:
    "border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]",
};

export function CoverageBadge({ coverage }: { coverage: LiveTradeZoneCoverage }) {
  const meta = COVERAGE_META[coverage];
  return (
    <span title={meta.description}>
      <Badge
        variant={meta.tone}
        className={cn("px-2 py-0.5 text-[9.5px] font-bold", TONE_CLASS[meta.tone])}
      >
        {meta.label}
      </Badge>
    </span>
  );
}
