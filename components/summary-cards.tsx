"use client";

import { Activity, Boxes, Clock3, ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { SummaryCardSkeleton } from "@/components/ui/skeleton";

type Accent = "info" | "positive" | "gold" | "warning";

interface SummaryCardProps {
  label: string;
  value: string | number | null | undefined;
  subtext?: string;
  icon: React.ReactNode;
  accent: Accent;
  loading?: boolean;
}

const ACCENT: Record<
  Accent,
  { iconBg: string; iconColor: string; valueColor: string; rule: string }
> = {
  info: {
    iconBg: "var(--ds-info-soft)",
    iconColor: "var(--ds-info)",
    valueColor: "var(--ds-text)",
    rule: "var(--ds-info)",
  },
  positive: {
    iconBg: "var(--ds-positive-soft)",
    iconColor: "var(--ds-positive)",
    valueColor: "var(--ds-positive)",
    rule: "var(--ds-positive)",
  },
  gold: {
    iconBg: "var(--ds-gold-50)",
    iconColor: "var(--ds-gold-700)",
    valueColor: "var(--ds-text)",
    rule: "var(--ds-gold-500)",
  },
  warning: {
    iconBg: "var(--ds-warning-soft)",
    iconColor: "var(--ds-warning)",
    valueColor: "var(--ds-text)",
    rule: "var(--ds-warning)",
  },
};

function SummaryCard({
  label,
  value,
  subtext,
  icon,
  accent,
  loading,
}: SummaryCardProps) {
  if (loading) return <SummaryCardSkeleton />;
  const styles = ACCENT[accent];

  return (
    <div
      className="relative flex min-h-[122px] flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-shadow duration-200 hover:shadow-[var(--ds-shadow-card)] sm:p-5"
      style={{
        borderColor: "var(--ds-border)",
        background: "var(--ds-surface)",
        boxShadow: "0 1px 0 rgb(41 39 32 / 0.02)",
      }}
    >
      <span
        className="absolute inset-x-0 top-0 h-[2px] opacity-80"
        style={{ background: styles.rule }}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="pt-0.5 text-[12px] font-semibold leading-5 text-[var(--ds-text-secondary)] sm:text-[13px]">
          {label}
        </p>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9"
          style={{ background: styles.iconBg, color: styles.iconColor }}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>

      <div className="mt-3 min-w-0">
        <p
          className={cn(
            "ds-mono truncate text-[clamp(1.45rem,5vw,1.9rem)] font-semibold leading-none tracking-tight",
            value == null && "text-[var(--ds-text-muted)]"
          )}
          style={value != null ? { color: styles.valueColor } : undefined}
          title={value != null ? String(value) : undefined}
        >
          {value ?? "—"}
        </p>
        {subtext && (
          <p className="mt-2 truncate text-[11px] font-medium text-[var(--ds-text-muted)]">
            {subtext}
          </p>
        )}
      </div>
    </div>
  );
}

interface SummaryCardsProps {
  instrumentsLoaded?: number;
  symbolsWithQuotes?: number;
  matchingFilter?: number;
  fetchedAt?: string | null;
  loading?: boolean;
}

export function SummaryCards({
  instrumentsLoaded,
  symbolsWithQuotes,
  matchingFilter,
  fetchedAt,
  loading,
}: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <SummaryCard
        label="Instruments Loaded"
        value={instrumentsLoaded?.toLocaleString("en-IN")}
        subtext="From NSE EQ segment"
        accent="info"
        icon={<Boxes className="h-4 w-4" strokeWidth={1.75} />}
        loading={loading}
      />
      <SummaryCard
        label="Live Quotes"
        value={symbolsWithQuotes?.toLocaleString("en-IN")}
        subtext="With valid quote data"
        accent="positive"
        icon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
        loading={loading}
      />
      <SummaryCard
        label="Filtered Results"
        value={matchingFilter?.toLocaleString("en-IN")}
        subtext="Matching active filters"
        accent="gold"
        icon={<ListFilter className="h-4 w-4" strokeWidth={1.75} />}
        loading={loading}
      />
      <SummaryCard
        label="Last Refresh"
        value={fetchedAt ? new Date(fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" }) : null}
        subtext="IST"
        accent="warning"
        icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
        loading={loading}
      />
    </div>
  );
}
