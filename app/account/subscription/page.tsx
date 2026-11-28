"use client";

import { OverviewShell } from "@/components/overview/app-shell";
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
    <OverviewShell lastRefreshed={null}>
      <main className="mx-auto w-full max-w-[1280px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="border-b border-[var(--ds-border)] pb-6">
          <p className="ds-label">Account</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)] sm:text-3xl">
            Subscription
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ds-text-secondary)]">
            Your DemandScan account, plan and access status. Dates use the Asia/Kolkata calendar.
          </p>
        </header>

        {loading ? (
          <div className="space-y-4" aria-label="Loading subscription status">
            <div className="ds-skeleton h-40" />
            <div className="ds-skeleton h-32" />
          </div>
        ) : !appUser ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Sign in to view your subscription
            </h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Your current access status and recorded plan history will appear here.
            </p>
            <Button
              variant="primary"
              size="md"
              light
              className="mt-5"
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
          <div className="ds-alert ds-alert-negative" role="alert">
            <p>{error}</p>
            <Button
              variant="secondary"
              size="sm"
              light
              className="mt-3"
              onClick={() => void refetch()}
            >
              Try again
            </Button>
          </div>
        ) : data ? (
          <>
            <section className="ds-panel p-5 sm:p-7" aria-labelledby="account-title">
              <div className="flex flex-col gap-5 border-b border-[var(--ds-border)] pb-6 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="ds-label">Signed in as</p>
                  <h2 id="account-title" className="mt-2 text-xl font-semibold tracking-[-0.02em] text-[var(--ds-text)]">
                    {appUser.displayName || appUser.email}
                  </h2>
                  <p className="mt-1 break-all text-sm text-[var(--ds-text-secondary)]">{appUser.email}</p>
                </div>
                <Badge
                  variant={
                    data.subscriptionRequired
                      ? data.entitled
                        ? "success"
                        : "warning"
                      : "info"
                  }
                  light
                  dot={data.entitled}
                  className="self-start"
                >
                  {data.subscriptionRequired
                    ? data.entitled
                      ? "Access active"
                      : "Access inactive"
                    : "Administrator account"}
                </Badge>
              </div>

              <div className="pt-6">
                {!data.subscriptionRequired ? (
                  <p className="max-w-3xl text-sm leading-6 text-[var(--ds-text-secondary)]">
                    Administrative accounts are managed by role and do not need a customer subscription. They also have access to the administration console.
                  </p>
                ) : data.current ? (
                  <CurrentPlan
                    subscription={data.current}
                    today={data.today}
                    daysRemaining={data.current.daysRemaining}
                  />
                ) : (
                  <div className="ds-alert ds-alert-warning">
                    No subscription is assigned to your account. Contact your DemandScan administrator to activate access.
                  </div>
                )}
              </div>
            </section>

            {data.subscriptionRequired && (
              <section className="ds-panel overflow-hidden" aria-labelledby="payments-title">
                <div className="flex flex-col gap-2 border-b border-[var(--ds-border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                  <h2 id="payments-title" className="text-base font-semibold text-[var(--ds-text)]">
                    Payment records
                  </h2>
                  <span className="text-xs text-[var(--ds-text-secondary)]">Recorded by DemandScan staff</span>
                </div>
                {data.payments.length === 0 ? (
                  <div className="px-5 py-6 sm:px-7">
                    <p className="text-sm leading-6 text-[var(--ds-text-secondary)]">
                      No payments have been recorded. Payments are entered manually by an administrator; there is no online payment on this page.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="ds-table-wrap border-0 rounded-none" tabIndex={0} role="region" aria-label="Payment records table">
                      <table className="ds-table min-w-[760px]">
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Amount</th>
                            <th scope="col">Method</th>
                            <th scope="col">Reference</th>
                            <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.payments.slice(0, 10).map((payment) => (
                            <tr key={payment.paymentId}>
                              <td className="ds-mono whitespace-nowrap">{payment.paymentDate}</td>
                              <td className="ds-mono whitespace-nowrap font-medium text-[var(--ds-text)]">
                                {payment.currency} {payment.amount}
                              </td>
                              <td className="whitespace-nowrap">{payment.paymentMethod}</td>
                              <td className="text-[var(--ds-text-secondary)]">{payment.paymentReference || "—"}</td>
                              <td>
                                <Badge
                                  variant={payment.paymentStatus === "RECORDED" ? "success" : "neutral"}
                                  light
                                >
                                  {payment.paymentStatus}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {data.payments.length > 10 && (
                      <p className="border-t border-[var(--ds-border)] px-5 py-3 text-xs text-[var(--ds-text-secondary)] sm:px-7">
                        Showing the first 10 payment records returned.
                      </p>
                    )}
                  </>
                )}
              </section>
            )}

            {data.subscriptionRequired && data.history.length > 0 && (
              <section className="ds-panel overflow-hidden" aria-labelledby="history-title">
                <div className="border-b border-[var(--ds-border)] px-5 py-5 sm:px-7">
                  <h2 id="history-title" className="text-base font-semibold text-[var(--ds-text)]">
                    Subscription history
                  </h2>
                </div>
                <div className="ds-table-wrap border-0 rounded-none" tabIndex={0} role="region" aria-label="Subscription history table">
                  <table className="ds-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th scope="col">Plan</th>
                        <th scope="col">Period</th>
                        <th scope="col">Status</th>
                        <th scope="col">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.history.map((item) => (
                        <tr key={item.subscriptionId}>
                          <td className="font-medium text-[var(--ds-text)]">{item.planName}</td>
                          <td className="ds-mono whitespace-nowrap text-[var(--ds-text-secondary)]">
                            {item.startDate} → {item.endDate}
                          </td>
                          <td>
                            <Badge variant={STATUS_VARIANT[item.effectiveStatus]} light>
                              {statusLabel(item.effectiveStatus)}
                            </Badge>
                          </td>
                          <td className="text-[var(--ds-text-secondary)]">
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

            <div className="ds-panel-subtle flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p className="text-sm text-[var(--ds-text-secondary)]">
                To change or renew your plan, contact your DemandScan administrator.
              </p>
              <Button variant="ghost" size="sm" light onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </>
        ) : null}
      </main>
    </OverviewShell>
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)]">
          {subscription.planName}
        </h3>
        <Badge variant={STATUS_VARIANT[subscription.effectiveStatus]} light dot>
          {statusLabel(subscription.effectiveStatus)}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] p-4 sm:grid-cols-4 sm:p-5">
        <Detail label="Activated" value={subscription.startDate} />
        <Detail label="Expires (inclusive)" value={subscription.endDate} />
        <Detail
          label="Days remaining"
          value={daysRemaining === null ? "—" : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`}
        />
        <Detail label="Today (IST)" value={today} />
      </dl>
      {subscription.effectiveStatus !== "ACTIVE" && (
        <p className="ds-alert ds-alert-warning">
          This plan is not currently providing access. Contact your administrator to reactivate or renew it.
        </p>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-[var(--ds-text-secondary)]">{label}</dt>
      <dd className="ds-mono mt-1.5 text-sm font-medium text-[var(--ds-text)]">{value}</dd>
    </div>
  );
}
