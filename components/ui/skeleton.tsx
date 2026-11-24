"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--ds-surface-subtle)]", className)}
      aria-hidden="true"
    />
  );
}

export function StockTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
      aria-hidden="true"
    >
      <div className="flex items-center gap-4 border-b border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-4 py-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-32 flex-1" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="hidden h-3 w-14 sm:block" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-[var(--ds-border)]/60 px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-3 w-28 flex-1" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="hidden h-4 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}

export function SummaryCardSkeleton() {
  return (
    <div
      className="flex min-h-[122px] flex-col justify-between rounded-2xl border p-4 sm:p-5"
      style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface)" }}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-2.5 w-28" />
      </div>
    </div>
  );
}
