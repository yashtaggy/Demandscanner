"use client";

import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  light?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  light = false,
  loading = false,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const darkVariantClasses = {
    primary:
      "bg-indigo-600 hover:bg-indigo-500 text-white border-transparent shadow-indigo-900/30",
    secondary:
      "bg-slate-700 hover:bg-slate-600 text-slate-100 border-slate-600 hover:border-slate-500",
    ghost: "bg-transparent hover:bg-slate-700/50 text-slate-300 hover:text-slate-100 border-slate-700/50",
    danger: "bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border-rose-500/30",
    success: "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border-emerald-500/30",
  };
  const lightVariantClasses = {
    primary:
      "border-[var(--ds-gold-500)] bg-[var(--ds-gold-300)] text-[var(--ds-text)] hover:bg-[var(--ds-gold-500)]",
    secondary:
      "border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-secondary)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)]",
    ghost:
      "border-[var(--ds-border)] bg-transparent text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)]",
    danger:
      "border-[color-mix(in_srgb,var(--ds-negative)_30%,transparent)] bg-[var(--ds-negative-soft)] text-[color-mix(in_srgb,var(--ds-negative)_90%,var(--ds-text))] hover:bg-[color-mix(in_srgb,var(--ds-negative)_12%,var(--ds-surface-elevated))]",
    success:
      "border-[color-mix(in_srgb,var(--ds-positive)_30%,transparent)] bg-[var(--ds-positive-soft)] text-[var(--ds-positive)] hover:bg-[color-mix(in_srgb,var(--ds-positive)_12%,var(--ds-surface-elevated))]",
  };

  const sizeClasses = {
    sm: "text-xs px-3 py-1.5 gap-1.5",
    md: "text-sm px-4 py-2 gap-2",
    lg: "text-base px-5 py-2.5 gap-2.5",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg border font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        light
          ? "min-h-11 focus-visible:ring-[var(--ds-gold-700)] focus-visible:ring-offset-[var(--ds-canvas)]"
          : "focus-visible:ring-indigo-500 focus-visible:ring-offset-slate-900",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        "shadow-sm",
        light ? lightVariantClasses[variant] : darkVariantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
