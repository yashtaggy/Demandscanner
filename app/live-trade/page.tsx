"use client";

import { Header } from "@/components/header";
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

  const market = brokerStatus?.market
    ? {
        isOpen: brokerStatus.market.isOpen,
        exchange: brokerStatus.market.exchange,
      }
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={null} />

      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        {authLoading ? (
          <div
            className="space-y-3"
            aria-label="Checking your DemandScan session"
          >
            <div className="h-36 animate-pulse rounded-2xl bg-slate-800/40" />
            <div className="h-10 animate-pulse rounded-lg bg-slate-800/30" />
            <div className="h-44 animate-pulse rounded-xl bg-slate-800/30" />
          </div>
        ) : !appUser ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-indigo-500/30 bg-indigo-500/5 px-6 py-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/15">
              <svg
                className="h-7 w-7 text-indigo-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 3 3 5-6" />
              </svg>
            </div>
            <h1 className="mt-4 text-base font-semibold text-slate-100">
              Sign in to use Live Trade
            </h1>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              Live Trade keeps its board, groups and trade plans against your
              DemandScan account. Connecting Kite is a separate step used only
              for market quotes.
            </p>
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="mt-5"
              onClick={() => {
                window.location.assign(
                  new URL("/login?next=%2Flive-trade", window.location.origin).toString()
                );
              }}
            >
              Sign in
            </Button>
          </div>
        ) : subscriptionLoading ? (
          <SubscriptionAccessNotice checking current={null} />
        ) : accessBlocked ? (
          <SubscriptionAccessNotice current={subscription?.current ?? null} />
        ) : (
          <LiveTradeWorkspace
            authMarket={market}
            brokerConnected={brokerConnected}
          />
        )}
      </main>
    </div>
  );
}
