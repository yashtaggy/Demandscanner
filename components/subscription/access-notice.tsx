"use client";

import { Button } from "@/components/ui/button";
import { useAppAuth } from "@/hooks/use-app-auth";
import type { EffectiveSubscriptionStatus, Subscription } from "@/lib/subscriptions/types";

function describe(
  status: EffectiveSubscriptionStatus | "UNKNOWN",
  current: Subscription | null
): string {
  switch (status) {
    case "PENDING":
      return "Your subscription is assigned but has not been activated yet. Ask your administrator to activate it.";
    case "EXPIRED":
      return current
        ? `Your subscription ended on ${current.endDate} (Asia/Kolkata). Ask your administrator to renew it.`
        : "Your subscription has expired. Ask your administrator to renew it.";
    case "CANCELLED":
      return "Your subscription was cancelled. Ask your administrator if you need access again.";
    case "NONE":
      return "No subscription is assigned to your account yet. Ask your administrator to set one up.";
    default:
      return "Activate your account to use DemandScan features.";
  }
}

/**
 * Access-inactive panel. It deliberately renders no scanner, stock or Live
 * Trade data; the server rejects those requests as well, so this is an
 * explanation layer, not the security boundary.
 */
export function SubscriptionAccessNotice({
  current,
  checking = false,
  message,
  light = false,
}: {
  current: Subscription | null;
  checking?: boolean;
  message?: string;
  light?: boolean;
}) {
  const { logout } = useAppAuth();

  if (checking) {
    return (
      <div
        className={
          light
            ? "mx-auto max-w-lg rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-6 py-10 text-center shadow-[var(--ds-shadow-card)]"
            : "mx-auto max-w-lg rounded-2xl border border-slate-700/50 bg-slate-800/30 px-6 py-10 text-center"
        }
      >
        <div
          className={
            light
              ? "mx-auto h-4 w-40 animate-pulse rounded bg-[var(--ds-surface-subtle)]"
              : "mx-auto h-4 w-40 animate-pulse rounded bg-slate-700"
          }
        />
        <div
          className={
            light
              ? "mx-auto mt-3 h-3 w-56 animate-pulse rounded bg-[var(--ds-surface-subtle)]"
              : "mx-auto mt-3 h-3 w-56 animate-pulse rounded bg-slate-800"
          }
        />
        <p
          className={
            light
              ? "mt-4 text-xs text-[var(--ds-text-muted)]"
              : "mt-4 text-xs text-slate-500"
          }
        >
          Checking your subscription…
        </p>
      </div>
    );
  }

  const status = current?.effectiveStatus ?? "NONE";

  return (
    <div
      className={
        light
          ? "mx-auto max-w-lg rounded-2xl border border-[var(--ds-gold-300)] bg-[var(--ds-surface)] px-6 py-10 text-center shadow-[var(--ds-shadow-card)]"
          : "mx-auto max-w-lg rounded-2xl border border-amber-500/30 bg-amber-500/5 px-6 py-10 text-center"
      }
    >
      <div
        className={
          light
            ? "mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ds-gold-100)]"
            : "mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15"
        }
      >
        <svg
          className={light ? "h-7 w-7 text-[var(--ds-gold-700)]" : "h-7 w-7 text-amber-400"}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <h1
        className={
          light
            ? "mt-4 text-base font-semibold text-[var(--ds-text)]"
            : "mt-4 text-base font-semibold text-slate-100"
        }
      >
        Subscription inactive
      </h1>
      {current ? (
        <p
          className={
            light
              ? "mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--ds-text-secondary)]"
              : "mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-400"
          }
        >
          Plan{" "}
          <span className={light ? "font-semibold text-[var(--ds-text)]" : "text-slate-200"}>
            {current.planName}
          </span>{" "}
          · {current.startDate} to {current.endDate} · Status {status}
        </p>
      ) : null}
      <p
        className={
          light
            ? "mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--ds-text-secondary)]"
            : "mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500"
        }
      >
        {message ?? describe(status, current)}
      </p>
      <p
        className={
          light
            ? "mx-auto mt-2 max-w-sm text-xs leading-relaxed text-[var(--ds-text-muted)]"
            : "mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-600"
        }
      >
        Your data is retained. Scanner and Live Trade access returns as soon as
        an active subscription is in place.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="primary"
          size="sm"
          className={
            light
              ? "min-h-11 border-[var(--ds-gold-500)] bg-[var(--ds-gold-300)] text-[var(--ds-text)] hover:bg-[var(--ds-gold-500)] focus-visible:ring-[var(--ds-gold-700)] focus-visible:ring-offset-[var(--ds-canvas)]"
              : undefined
          }
          onClick={() => {
            window.location.assign(
              new URL("/account/subscription", window.location.origin).toString()
            );
          }}
        >
          View subscription status
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={
            light
              ? "min-h-11 border-[var(--ds-border)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-gold-50)] hover:text-[var(--ds-text)] focus-visible:ring-offset-[var(--ds-canvas)]"
              : undefined
          }
          onClick={() => void logout()}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
