"use client";

import { useUnreadCount } from "@/hooks/use-unread-count";
import { unreadBadgeLabel } from "@/lib/signals/ui";

/** Small unread-count pill rendered next to the customer Signals nav entry. */
export function UnreadNavBadge() {
  const count = useUnreadCount(true);
  const label = unreadBadgeLabel(count);
  if (!label) return null;

  return (
    <span
      className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 tabular-nums"
      aria-label={`${label} unread signals`}
    >
      {label}
    </span>
  );
}
