"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  closeDisabled?: boolean;
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal following the existing hand-rolled drawer pattern.
 * Escape and backdrop clicks route through `onClose`, which lets callers guard
 * unsaved edits. Focus is restored to the trigger on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "lg",
  closeDisabled = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    closeRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [onClose, closeDisabled]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || panel === null) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(30_28_23/0.62)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm animate-in fade-in duration-200 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-2xl border border-[var(--ds-border-strong)] bg-[var(--ds-surface-elevated)] shadow-[var(--ds-shadow-float)]",
          "animate-in slide-in-from-top-1 duration-200 focus:outline-none",
          SIZE_CLASS[size]
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--ds-border)] bg-[var(--ds-gold-50)]/45 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--ds-gold-700)]">
              Live Trade
            </p>
            <h2 id={titleId} className="mt-1 text-base font-bold text-[var(--ds-text)]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-[var(--ds-text-secondary)]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close dialog"
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--ds-text-muted)] transition-colors hover:bg-[var(--ds-gold-100)] hover:text-[var(--ds-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>

        {footer && (
          <div className="border-t border-[var(--ds-border)] bg-[var(--ds-surface)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
