"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { UNREAD_REFRESH_EVENT } from "@/lib/signals/ui";

const POLL_INTERVAL_MS = 60_000;

/**
 * The signed-in customer's unread signal count.
 *
 * Refreshes on mount, on navigation, on window focus and when the detail page
 * broadcasts a read-state change. While the tab is visible it polls once a
 * minute; polling stops when the tab is hidden or the component unmounts.
 * `null` means the count is unknown, which renders no badge.
 */
export function useUnreadCount(enabled: boolean): number | null {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      try {
        const res = await fetch("/api/signals/unread-count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { unreadCount?: unknown };
        if (!active || typeof data.unreadCount !== "number") return;
        setCount(data.unreadCount);
      } catch {
        // Transient network failure: keep the last known badge.
      }
    };

    const startPolling = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        void load();
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load();
        startPolling();
      } else {
        stopPolling();
      }
    };

    void load();
    startPolling();
    window.addEventListener("focus", load);
    window.addEventListener(UNREAD_REFRESH_EVENT, load);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      stopPolling();
      window.removeEventListener("focus", load);
      window.removeEventListener(UNREAD_REFRESH_EVENT, load);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, pathname]);

  return count;
}
