"use client";

import { useEffect, useRef, useState } from "react";
import { Download, MoreHorizontal, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScannerActionsMenuProps {
  onRefresh: () => void;
  refreshing?: boolean;
  exporting: "json" | "csv" | null;
  onExport: (format: "json" | "csv") => void;
  disabled?: boolean;
}

/**
 * Overflow utilities for the Scanner page. The export endpoint only honours
 * timeframe, side, lifecycle, minScore, limit and offset, so the disclosure is
 * deliberately explicit rather than implying every filter is applied.
 */
export function ScannerActionsMenu({
  onRefresh,
  refreshing = false,
  exporting,
  onExport,
  disabled = false,
}: ScannerActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More scanner actions"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Scanner utilities"
          className="ds-fade-in absolute right-0 top-[calc(100%+8px)] z-40 w-[288px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border shadow-xl"
          style={{
            borderColor: "var(--ds-border)",
            background: "var(--ds-surface-elevated)",
            boxShadow: "var(--ds-shadow-float)",
          }}
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRefresh();
            }}
            disabled={refreshing}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)] disabled:opacity-60"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
              strokeWidth={2}
              aria-hidden="true"
            />
            {refreshing ? "Refreshing…" : "Refresh results"}
          </button>

          <div className="mx-3 border-t" style={{ borderColor: "var(--ds-border)" }} />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExport("csv");
            }}
            disabled={exporting !== null}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)] disabled:opacity-60"
          >
            <Download
              className={cn("h-3.5 w-3.5", exporting === "csv" && "animate-pulse")}
              strokeWidth={2}
              aria-hidden="true"
            />
            {exporting === "csv" ? "Exporting CSV…" : "Export CSV"}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExport("json");
            }}
            disabled={exporting !== null}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12px] font-semibold text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)] disabled:opacity-60"
          >
            <Download
              className={cn("h-3.5 w-3.5", exporting === "json" && "animate-pulse")}
              strokeWidth={2}
              aria-hidden="true"
            />
            {exporting === "json" ? "Exporting JSON…" : "Export JSON"}
          </button>

          <p
            className="border-t px-3.5 py-2.5 text-[10.5px] leading-relaxed text-[var(--ds-text-muted)]"
            style={{ borderColor: "var(--ds-border)" }}
          >
            Exports apply timeframe, side, lifecycle and minimum formation score only.
            Symbol, pattern, advanced and date filters are not included in the file.
          </p>
        </div>
      )}
    </div>
  );
}
