"use client";

import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "success" | "danger" | "warning" | "neutral" | "info";
  size?: "sm" | "md";
  dot?: boolean;
  light?: boolean;
  className?: string;
}

export function Badge({
  children,
  variant = "neutral",
  size = "sm",
  dot = false,
  light = false,
  className,
}: BadgeProps) {
  const darkVariantClasses = {
    success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    danger: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    neutral: "bg-slate-700/50 text-slate-300 border-slate-600/50",
    info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  };
  const lightVariantClasses = {
    success:
      "border-[color-mix(in_srgb,var(--ds-positive)_30%,transparent)] bg-[var(--ds-positive-soft)] text-[var(--ds-positive)]",
    danger:
      "border-[color-mix(in_srgb,var(--ds-negative)_30%,transparent)] bg-[var(--ds-negative-soft)] text-[color-mix(in_srgb,var(--ds-negative)_90%,var(--ds-text))]",
    warning:
      "border-[color-mix(in_srgb,var(--ds-warning)_30%,transparent)] bg-[var(--ds-warning-soft)] text-[var(--ds-warning)]",
    neutral: "border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]",
    info: "border-[color-mix(in_srgb,var(--ds-info)_30%,transparent)] bg-[var(--ds-info-soft)] text-[var(--ds-info)]",
  };

  const darkDotColors = {
    success: "bg-emerald-400",
    danger: "bg-rose-400",
    warning: "bg-amber-400",
    neutral: "bg-slate-400",
    info: "bg-blue-400",
  };
  const lightDotColors = {
    success: "bg-[var(--ds-positive)]",
    danger: "bg-[var(--ds-negative)]",
    warning: "bg-[var(--ds-warning)]",
    neutral: "bg-[var(--ds-text-muted)]",
    info: "bg-[var(--ds-info)]",
  };

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-3 py-1",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        light ? lightVariantClasses[variant] : darkVariantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full animate-pulse",
            light ? lightDotColors[variant] : darkDotColors[variant]
          )}
        />
      )}
      {children}
    </span>
  );
}
