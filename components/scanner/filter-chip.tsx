"use client";

import { cn } from "@/lib/utils";

interface FilterChipProps {
  id: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  colorClass?: string;
  tone?: "positive" | "negative";
  className?: string;
  title?: string;
}

/**
 * Shared filter chip. The `.ds-scanner-light` container in globals.css
 * restyles these chips with design tokens on light surfaces; the utility
 * classes below remain the dark presentation used by the legacy ScannerControls.
 */
export function FilterChip({
  id,
  active,
  onClick,
  children,
  colorClass = "",
  tone,
  className,
  title,
}: FilterChipProps) {
  return (
    <button
      type="button"
      id={id}
      data-active={active}
      data-chip
      data-tone={tone}
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-all duration-150",
        active
          ? colorClass || "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
          : "border-slate-700/50 bg-slate-800/40 text-slate-500 hover:border-slate-600/60 hover:text-slate-300",
        colorClass,
        className
      )}
    >
      {children}
    </button>
  );
}
