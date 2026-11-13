"use client";

import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppAuth } from "@/hooks/use-app-auth";
import { useSubscription } from "@/hooks/use-subscription";
import type {
  EffectiveSubscriptionStatus,
  Subscription,
} from "@/lib/subscriptions/types";

const STATUS_VARIANT: Record<
  EffectiveSubscriptionStatus,
  "success" | "info" | "danger" | "warning" | "neutral"
> = {
  ACTIVE: "success",
  PENDING: "info",
  EXPIRED: "danger",
  CANCELLED: "warning",
  NONE: "neutral",
};

function statusLabel(status: EffectiveSubscriptionStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default function AccountSubscriptionPage() {
  const { user: appUser, loading: authLoading, logout } = useAppAuth();
  const {
    data,
    loading: subscriptionLoading,
    error,
    refetch,
  } = useSubscription(Boolean(appUser));

  const loading = authLoading || (Boolean(appUser) && subscriptionLoading);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={null} />

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Subscription</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Your DemandScan account, plan and access status. Dates use the
            Asia/Kolkata calendar.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3" aria-label="Loading subscription status">
            <div className="h-32 animate-pulse rounded-2xl bg-slate-800/40" />
            <div className="h-24 animate-pulse rounded-xl bg-slate-800/30" />
          </div>
        ) : !appUser ? (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Sign in to view your subscription
            </h2>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => {
                window.location.assign(
                  new URL(
                    "/login?next=%2Faccount%2Fsubscription",
                    window.location.origin
                  ).toString()
                );
              }}
            >
              Sign in
            </Button>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
            <p>{error}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void refetch()}
            >
              Try again
            </Button>
          </div>
        ) : data ? (
          <>
            <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600">
                    Signed in as
                  </p>
                  <p className="text-sm font-medium text-slate-200">
                    {appUser.displayName || appUser.email}
                  </p>
                  <p className="text-xs text-slate-500">{appUser.email}</p>
                </div>
                <Badge
                  variant={
                    data.subscriptionRequired
                      ? data.entitled
                        ? "success"
                        : "warning"
                      : "info"
                  }
                  dot={data.entitled}
                >
                  {data.subscriptionRequired
                    ? data.entitled
                      ? "Access active"
                      : "Access inactive"
                    : "Administrator account"}
                </Badge>
              </div>

              {!data.subscriptionRequired ? (
                <p className="text-sm text-slate-400">
                  Administrative accounts are managed by role and do not need a
                  customer subscription. They also have access to the
                  administration console.
                </p>
              ) : data.current ? (
                <CurrentPlan
                  subscription={data.current}
                  today={data.today}
                  daysRemaining={data.current.daysRemaining}
                />
              ) : (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
                  No subscription is assigned to your account. Contact your
                  DemandScan administrator to activate access.
                </div>
              )}
            </section>

            {data.subscriptionRequired && (
              <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-200">
                    Payment records
                  </h2>
                  <span className="text-[11px] text-slate-500">
                    Recorded by DemandScan staff
                  </span>
                </div>
                {data.payments.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No payments have been recorded. Payments are entered
                    manually by an administrator; there is no online payment on
                    this page.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500">
                        <tr className="border-b border-slate-700/50">
                          <th className="py-2 pr-3 font-medium">Date</th>
                          <th className="py-2 pr-3 font-medium">Amount</th>
                          <th className="py-2 pr-3 font-medium">Method</th>
                          <th className="py-2 pr-3 font-medium">Reference</th>
                          <th className="py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {data.payments.slice(0, 10).map((payment) => (
                          <tr
                            key={payment.paymentId}
                            className="border-b border-slate-800/60 last:border-0"
                          >
                            <td className="py-2 pr-3 tabular-nums">
                              {payment.paymentDate}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {payment.currency} {payment.amount}
                            </td>
                            <td className="py-2 pr-3">{payment.paymentMethod}</td>
                            <td className="py-2 pr-3 text-slate-500">
                              {payment.paymentReference || "—"}
                            </td>
                            <td className="py-2">
                              <Badge
                                variant={
                                  payment.paymentStatus === "RECORDED"
                                    ? "success"
                                    : "neutral"
                                }
                              >
                                {payment.paymentStatus}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {data.subscriptionRequired && data.history.length > 0 && (
              <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-3">
                <h2 className="text-sm font-semibold text-slate-200">
                  Subscription history
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr className="border-b border-slate-700/50">
                        <th className="py-2 pr-3 font-medium">Plan</th>
                        <th className="py-2 pr-3 font-medium">Period</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {data.history.map((item) => (
                        <tr
                          key={item.subscriptionId}
                          className="border-b border-slate-800/60 last:border-0"
                        >
                          <td className="py-2 pr-3">{item.planName}</td>
                          <td className="py-2 pr-3 tabular-nums text-slate-400">
                            {item.startDate} → {item.endDate}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge variant={STATUS_VARIANT[item.effectiveStatus]}>
                              {statusLabel(item.effectiveStatus)}
                            </Badge>
                          </td>
                          <td className="py-2 text-slate-500">
                            {item.cancellationReason ||
                              (item.renewedFromSubscriptionId ? "Renewal" : "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/50 bg-slate-800/20 px-5 py-4">
              <p className="text-xs text-slate-500">
                To change or renew your plan, contact your DemandScan
                administrator.
              </p>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function CurrentPlan({
  subscription,
  today,
  daysRemaining,
}: {
  subscription: Subscription;
  today: string;
  daysRemaining: number | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xl font-bold text-slate-100">
          {subscription.planName}
        </p>
        <Badge variant={STATUS_VARIANT[subscription.effectiveStatus]}>
          {statusLabel(subscription.effectiveStatus)}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail label="Activated" value={subscription.startDate} />
        <Detail label="Expires (inclusive)" value={subscription.endDate} />
        <Detail
          label="Days remaining"
          value={
            daysRemaining === null ? "—" : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`
          }
        />
        <Detail label="Today (IST)" value={today} />
      </dl>
      {subscription.effectiveStatus !== "ACTIVE" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
          This plan is not currently providing access. Contact your
          administrator to reactivate or renew it.
        </p>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-600">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}
