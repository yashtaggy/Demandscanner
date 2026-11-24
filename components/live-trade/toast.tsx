"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface UseToastsReturn {
  toasts: ToastMessage[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

const TOAST_DURATION_MS = 5000;
const MAX_TOASTS = 4;

export function useToasts(): UseToastsReturn {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setToasts((previous) => [...previous.slice(-(MAX_TOASTS - 1)), { id, kind, message }]);
      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

const KIND_STYLE: Record<ToastKind, { container: string; icon: string }> = {
  success: {
    container: "border-[var(--ds-positive)]/25",
    icon: "text-[var(--ds-positive)]",
  },
  error: {
    container: "border-[var(--ds-negative)]/25",
    icon: "text-[var(--ds-negative)]",
  },
  info: {
    container: "border-[var(--ds-info)]/25",
    icon: "text-[var(--ds-info)]",
  },
};

const KIND_ICON = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = KIND_ICON[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-3 rounded-xl border bg-[var(--ds-surface-elevated)] px-3.5 py-3 text-[var(--ds-text)] shadow-[var(--ds-shadow-float)] animate-in fade-in duration-200",
              KIND_STYLE[toast.kind].container
            )}
          >
            <Icon
              className={cn("mt-0.5 h-4 w-4 shrink-0", KIND_STYLE[toast.kind].icon)}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="flex-1 text-xs leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--ds-text-muted)] hover:bg-[var(--ds-surface-subtle)] hover:text-[var(--ds-text)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
