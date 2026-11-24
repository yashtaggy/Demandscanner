"use client";

import { ChartCandlestick, ShieldCheck } from "lucide-react";
import { OverviewShell } from "@/components/overview/app-shell";
import { Button } from "@/components/ui/button";
import { LiveTradeWorkspace } from "@/components/live-trade/workspace";
import { SubscriptionAccessNotice } from "@/components/subscription/access-notice";
import { useAppAuth } from "@/hooks/use-app-auth";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";

export default function LiveTradePage() {
  const { user: appUser, loading: authLoading } = useAppAuth();
  const { status: brokerStatus, loading: brokerLoading } = useAuth();
  const {
    data: subscription,
    loading: subscriptionLoading,
  } = useSubscription(Boolean(appUser));

  const accessBlocked =
    Boolean(appUser) &&
    !subscriptionLoading &&
    subscription !== null &&
    subscription.subscriptionRequired &&
    !subscription.entitled;

  const brokerConnected = brokerLoading
    ? null
    : (brokerStatus?.authenticated ?? false);

  return (
    <OverviewShell lastRefreshed={null}>
      <main className="ds-live-trade mx-auto w-full max-w-[1680px] px-4 pb-10 pt-5 sm:px-6 sm:pt-6 lg:px-8">
        {authLoading ? (
          <div
            className="space-y-4"
            aria-label="Checking your DemandScan session"
          >
            <div className="h-32 animate-pulse rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)]" />
            <div className="h-20 animate-pulse rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)]" />
            <div className="h-64 animate-pulse rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)]" />
          </div>
        ) : !appUser ? (
          <section className="mx-auto max-w-xl rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-6 py-10 text-center shadow-[var(--ds-shadow-card)] sm:px-10 sm:py-12">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--ds-gold-300)] bg-[var(--ds-gold-50)] text-[var(--ds-gold-700)]">
              <ChartCandlestick className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ds-gold-700)]">
              Private trading workspace
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--ds-text)]">
              Sign in to use Live Trade
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--ds-text-secondary)]">
              Keep your watchlist, groups and trade plans against your DemandScan
              account. Kite is a separate connection used only for market quotes.
            </p>
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="mt-6 min-h-11 border-[var(--ds-gold-500)] bg-[var(--ds-gold-300)] px-5 text-[var(--ds-text)] shadow-none hover:bg-[var(--ds-gold-500)] focus-visible:ring-[var(--ds-gold-700)] focus-visible:ring-offset-[var(--ds-canvas)]"
              onClick={() => {
                window.location.assign(
                  new URL("/login?next=%2Flive-trade", window.location.origin).toString()
                );
              }}
            >
              Sign in
            </Button>
            <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-[var(--ds-text-secondary)]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Your board remains private to your account.
            </p>
          </section>
        ) : subscriptionLoading ? (
          <SubscriptionAccessNotice checking current={null} light />
        ) : accessBlocked ? (
          <SubscriptionAccessNotice current={subscription?.current ?? null} light />
        ) : (
          <LiveTradeWorkspace brokerConnected={brokerConnected} />
        )}
      </main>
    </OverviewShell>
  );
}
