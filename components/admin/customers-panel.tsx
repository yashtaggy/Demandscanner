"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminRequest, inputClass } from "@/components/admin/admin-client";
import type {
  CustomerSubscriptionDetail,
  CustomerSubscriptionSummary,
  EffectiveSubscriptionStatus,
  SubscriptionPlan,
} from "@/lib/subscriptions/types";
import { todayInIst } from "@/lib/subscriptions/validation";

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

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function requestCustomers(
  search: string
): Promise<CustomerSubscriptionSummary[]> {
  const data = await adminRequest<{ customers: CustomerSubscriptionSummary[] }>(
    `/api/admin/customers?search=${encodeURIComponent(search.trim())}`,
    "GET"
  );
  return data.customers;
}

async function requestCustomer(
  userId: string
): Promise<CustomerSubscriptionDetail> {
  const data = await adminRequest<{ customer: CustomerSubscriptionDetail }>(
    `/api/admin/customers/${userId}`,
    "GET"
  );
  return data.customer;
}

export function CustomersPanel({ plans }: { plans: SubscriptionPlan[] }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerSubscriptionSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerSubscriptionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchList = useCallback(async (search: string) => {
    try {
      setCustomers(await requestCustomers(search));
      setListError(null);
    } catch (err) {
      setListError(messageFor(err, "Could not load customers"));
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (userId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await requestCustomer(userId));
    } catch (err) {
      setDetail(null);
      setDetailError(messageFor(err, "Could not load customer"));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    requestCustomers("").then(
      (list) => {
        if (!active) return;
        setCustomers(list);
        setListError(null);
        setListLoading(false);
      },
      (err: unknown) => {
        if (!active) return;
        setListError(messageFor(err, "Could not load customers"));
        setListLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  function select(userId: string) {
    setSelectedId(userId);
    void loadDetail(userId);
  }

  function search() {
    setListLoading(true);
    setListError(null);
    void fetchList(query);
  }

  async function refreshSelected() {
    if (selectedId) await loadDetail(selectedId);
    setListLoading(true);
    await fetchList(query);
  }

  return (
    <section className="ds-panel overflow-hidden" aria-labelledby="customers-title" aria-busy={listLoading}>
      <div className="flex flex-col gap-4 border-b border-[var(--ds-border)] px-5 py-5 lg:flex-row lg:items-center lg:justify-between sm:px-7">
        <div>
          <p className="ds-label">Accounts</p>
          <h2 id="customers-title" className="mt-2 text-lg font-semibold text-[var(--ds-text)]">
            Customers
          </h2>
          <p className="mt-1.5 text-sm text-[var(--ds-text-secondary)]">
            Search by email or name. Entitlement is computed by the database for the current IST date.
          </p>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row lg:w-full lg:max-w-md"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
        >
          <label htmlFor="customer-search" className="sr-only">
            Search customers
          </label>
          <input
            id="customer-search"
            className={`${inputClass} sm:min-w-0 sm:flex-1`}
            placeholder="Search email or name"
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button size="md" variant="secondary" light type="submit" loading={listLoading}>
            Search
          </Button>
        </form>
      </div>

      {listError && (
        <p className="ds-alert ds-alert-negative mx-3 mt-3 sm:mx-5" role="alert">
          {listError}
        </p>
      )}

      <div className="grid min-w-0 gap-4 p-3 sm:p-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] overflow-y-auto rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)]">
          {listLoading && customers.length === 0 ? (
            <div className="space-y-2 p-3" aria-label="Loading customers">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="ds-skeleton h-20" />
              ))}
            </div>
          ) : customers.length === 0 ? (
            <p className="p-4 text-sm text-[var(--ds-text-secondary)]">No customers found.</p>
          ) : (
            <ul className="divide-y divide-[var(--ds-border)]">
              {customers.map((customer) => (
                <li key={customer.userId}>
                  <button
                    type="button"
                    aria-pressed={selectedId === customer.userId}
                    onClick={() => select(customer.userId)}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-[var(--ds-gold-50)] ${
                      selectedId === customer.userId ? "bg-[var(--ds-gold-50)]" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[var(--ds-text)]">
                        {customer.displayName || customer.email}
                      </span>
                      <Badge variant={customer.entitled ? "success" : "neutral"} light className="shrink-0">
                        {customer.entitled ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex flex-col gap-1">
                      <span className="truncate text-xs text-[var(--ds-text-secondary)]">{customer.email}</span>
                      {customer.subscription && (
                        <span className="ds-mono text-[10px] text-[var(--ds-text-secondary)]">
                          {customer.subscription.startDate} → {customer.subscription.endDate}
                        </span>
                      )}
                    </div>
                    {customer.accountStatus !== "ACTIVE" && (
                      <p className="mt-1.5 text-[11px] font-medium text-[var(--ds-negative)]">
                        Account {customer.accountStatus.toLowerCase()}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {detailLoading ? (
            <div className="space-y-3" aria-label="Loading customer details">
              <div className="ds-skeleton h-40" />
              <div className="ds-skeleton h-56" />
            </div>
          ) : detailError ? (
            <p className="ds-alert ds-alert-negative" role="alert">
              {detailError}
            </p>
          ) : detail ? (
            <CustomerDetail detail={detail} plans={plans} onChanged={refreshSelected} />
          ) : (
            <div className="ds-empty min-h-40 flex items-center justify-center">
              <p className="text-sm text-[var(--ds-text-secondary)]">
                Select a customer to view subscriptions and payments.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CustomerDetail({
  detail,
  plans,
  onChanged,
}: {
  detail: CustomerSubscriptionDetail;
  plans: SubscriptionPlan[];
  onChanged: () => Promise<void>;
}) {
  const { customer, subscriptions, payments } = detail;
  const activePlans = plans.filter((plan) => plan.status === "ACTIVE");
  const today = todayInIst();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [statusReason, setStatusReason] = useState("");
  const [assignPlanId, setAssignPlanId] = useState(activePlans[0]?.planId ?? "");
  const [assignStart, setAssignStart] = useState(today);

  const [action, setAction] = useState<{
    subscriptionId: string;
    kind: "ACTIVATE" | "EXTEND" | "CANCEL" | "RENEW";
  } | null>(null);
  const [actionDays, setActionDays] = useState("30");
  const [actionReason, setActionReason] = useState("");
  const [actionStart, setActionStart] = useState("");

  const currentSubscription =
    subscriptions.find(
      (item) => item.status === "ACTIVE" && item.startDate <= today && item.endDate >= today
    ) ?? subscriptions[0] ?? null;
  const [paymentSubId, setPaymentSubId] = useState(currentSubscription?.subscriptionId ?? "");
  const [payAmount, setPayAmount] = useState(currentSubscription?.planPrice ?? "0.00");
  const [payMethod, setPayMethod] = useState("UPI");
  const [payReference, setPayReference] = useState("");
  const [payDate, setPayDate] = useState(today);
  const [payNotes, setPayNotes] = useState("");

  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await task();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  function changeAccountStatus(status: "ACTIVE" | "SUSPENDED") {
    if (status !== "ACTIVE" && statusReason.trim().length < 3) {
      setError("Enter a reason of at least 3 characters before suspending.");
      return;
    }
    void run(`status-${status}`, () =>
      adminRequest(`/api/admin/users/${customer.userId}/status`, "PATCH", {
        status,
        reason: statusReason.trim() || undefined,
      })
    );
  }

  function assign() {
    void run("assign", () =>
      adminRequest(`/api/admin/customers/${customer.userId}/subscriptions`, "POST", {
        planId: assignPlanId,
        startDate: assignStart || undefined,
      })
    );
  }

  function submitAction() {
    if (!action) return;
    const body: Record<string, unknown> = { action: action.kind };
    if (action.kind === "EXTEND") body.additionalDays = Number(actionDays);
    if (action.kind === "CANCEL") body.reason = actionReason;
    if (action.kind === "RENEW" && actionStart) body.startDate = actionStart;

    void run(`action-${action.kind}`, () =>
      adminRequest(
        `/api/admin/customers/${customer.userId}/subscriptions/${action.subscriptionId}`,
        "PATCH",
        body
      )
    ).then(() => {
      setAction(null);
      setActionDays("30");
      setActionReason("");
      setActionStart("");
    });
  }

  function recordPayment() {
    const subscription = subscriptions.find(
      (item) => item.subscriptionId === paymentSubId
    );
    if (!subscription) {
      setError("Choose a subscription before recording a payment.");
      return;
    }
    void run("payment", () =>
      adminRequest(`/api/admin/customers/${customer.userId}/payments`, "POST", {
        subscriptionId: subscription.subscriptionId,
        currency: subscription.planCurrency,
        amount: payAmount,
        paymentMethod: payMethod,
        paymentReference: payReference || undefined,
        paymentDate: payDate || undefined,
        notes: payNotes || undefined,
      })
    ).then(() => {
      setPayReference("");
      setPayNotes("");
    });
  }

  return (
    <div className="space-y-4">
      <section className="ds-panel-subtle p-4 sm:p-5" aria-labelledby="customer-account-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="ds-label">Customer account</p>
            <h3 id="customer-account-title" className="mt-2 break-words text-lg font-semibold text-[var(--ds-text)]">
              {customer.displayName || customer.email}
            </h3>
            <p className="mt-1 break-all text-sm text-[var(--ds-text-secondary)]">{customer.email}</p>
            <p className="ds-mono mt-2 text-[11px] text-[var(--ds-text-secondary)]">
              Created {customer.createdAt.slice(0, 10)}
            </p>
          </div>
          <Badge
            variant={customer.accountStatus === "ACTIVE" ? "success" : "danger"}
            light
            dot
            className="self-start"
          >
            Account {customer.accountStatus}
          </Badge>
        </div>

        <div className="mt-5 border-t border-[var(--ds-border)] pt-5">
          <label htmlFor="status-reason" className="ds-label">
            Reason for suspension or reactivation
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="status-reason"
              className={`${inputClass} sm:max-w-lg sm:flex-1`}
              placeholder="Enter a reason"
              aria-describedby="status-reason-help"
              value={statusReason}
              maxLength={500}
              onChange={(event) => setStatusReason(event.target.value)}
            />
            {customer.accountStatus === "ACTIVE" ? (
              <Button
                size="md"
                variant="danger"
                light
                loading={busy === "status-SUSPENDED"}
                onClick={() => changeAccountStatus("SUSPENDED")}
              >
                Suspend account
              </Button>
            ) : (
              <Button
                size="md"
                variant="success"
                light
                loading={busy === "status-ACTIVE"}
                onClick={() => changeAccountStatus("ACTIVE")}
              >
                Reactivate account
              </Button>
            )}
          </div>
          <p id="status-reason-help" className="mt-2 text-xs text-[var(--ds-text-secondary)]">
            Reactivating an account does not extend an expired subscription.
          </p>
        </div>
      </section>

      {error && (
        <p className="ds-alert ds-alert-negative" role="alert">
          {error}
        </p>
      )}

      <section className="ds-panel-subtle p-4 sm:p-5" aria-labelledby="assign-subscription-title">
        <h3 id="assign-subscription-title" className="text-sm font-semibold text-[var(--ds-text)]">
          Assign subscription
        </h3>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_auto] md:items-end">
          <label className="block">
            <span className="ds-label">Plan</span>
            <select
              className={`${inputClass} mt-2`}
              value={assignPlanId}
              onChange={(event) => setAssignPlanId(event.target.value)}
            >
              {activePlans.length === 0 && <option value="">No active plans</option>}
              {activePlans.map((plan) => (
                <option key={plan.planId} value={plan.planId}>
                  {plan.name} · {plan.durationDays}d · {plan.currency} {plan.price}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="ds-label">Start date (IST)</span>
            <input
              className={`${inputClass} mt-2 ds-mono`}
              type="date"
              value={assignStart}
              onChange={(event) => setAssignStart(event.target.value)}
            />
          </label>
          <Button size="md" light disabled={!assignPlanId} loading={busy === "assign"} onClick={assign}>
            Assign (pending)
          </Button>
        </div>
        <p className="mt-3 text-xs text-[var(--ds-text-secondary)]">
          Assignment creates a PENDING subscription. Activate it explicitly to grant access.
        </p>
      </section>

      <section className="ds-panel-subtle p-4 sm:p-5" aria-labelledby="subscriptions-title">
        <h3 id="subscriptions-title" className="text-sm font-semibold text-[var(--ds-text)]">
          Subscriptions
        </h3>
        {subscriptions.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ds-text-secondary)]">No subscriptions yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {subscriptions.map((subscription) => (
              <div
                key={subscription.subscriptionId}
                className="rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--ds-text)]">
                      {subscription.planName}{" "}
                      <span className="ds-mono text-xs font-normal text-[var(--ds-text-secondary)]">
                        {subscription.startDate} → {subscription.endDate}
                      </span>
                    </p>
                    <p className="mt-1.5 text-[11px] leading-5 text-[var(--ds-text-secondary)]">
                      Stored {subscription.status} · effective {subscription.effectiveStatus}
                      {subscription.daysRemaining !== null ? ` · ${subscription.daysRemaining} days left` : ""}
                    </p>
                    {subscription.cancellationReason && (
                      <p className="mt-1.5 text-[11px] text-[var(--ds-warning)]">
                        Cancelled: {subscription.cancellationReason}
                      </p>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[subscription.effectiveStatus]} light className="self-start">
                    {statusLabel(subscription.effectiveStatus)}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--ds-border)] pt-3">
                  {subscription.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="success"
                      light
                      onClick={() => setAction({ subscriptionId: subscription.subscriptionId, kind: "ACTIVATE" })}
                    >
                      Activate
                    </Button>
                  )}
                  {(subscription.status === "PENDING" || subscription.status === "ACTIVE") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      light
                      onClick={() => setAction({ subscriptionId: subscription.subscriptionId, kind: "EXTEND" })}
                    >
                      Extend
                    </Button>
                  )}
                  {subscription.status !== "CANCELLED" && (
                    <Button
                      size="sm"
                      variant="danger"
                      light
                      onClick={() => setAction({ subscriptionId: subscription.subscriptionId, kind: "CANCEL" })}
                    >
                      Cancel
                    </Button>
                  )}
                  {(subscription.status === "ACTIVE" || subscription.status === "EXPIRED") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      light
                      onClick={() => {
                        setActionStart("");
                        setAction({ subscriptionId: subscription.subscriptionId, kind: "RENEW" });
                      }}
                    >
                      Renew
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {action && (
          <div className="ds-alert ds-alert-info mt-4" aria-live="polite">
            <p className="font-semibold">{action.kind} subscription</p>
            {action.kind === "EXTEND" && (
              <label className="mt-3 block">
                <span className="ds-label">Additional days</span>
                <input
                  className={`${inputClass} mt-2 max-w-40`}
                  type="number"
                  min={1}
                  max={3660}
                  value={actionDays}
                  onChange={(event) => setActionDays(event.target.value)}
                />
              </label>
            )}
            {action.kind === "CANCEL" && (
              <label className="mt-3 block">
                <span className="ds-label">Cancellation reason</span>
                <input
                  className={`${inputClass} mt-2`}
                  value={actionReason}
                  maxLength={500}
                  onChange={(event) => setActionReason(event.target.value)}
                />
              </label>
            )}
            {action.kind === "RENEW" && (
              <label className="mt-3 block">
                <span className="ds-label">Start date (leave empty to start the day after the current end)</span>
                <input
                  className={`${inputClass} mt-2 max-w-56 ds-mono`}
                  type="date"
                  value={actionStart}
                  onChange={(event) => setActionStart(event.target.value)}
                />
              </label>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="md" light loading={busy === `action-${action.kind}`} onClick={submitAction}>
                Confirm {action.kind.toLowerCase()}
              </Button>
              <Button size="md" variant="ghost" light disabled={busy !== null} onClick={() => setAction(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="ds-panel-subtle p-4 sm:p-5" aria-labelledby="payments-title">
        <h3 id="payments-title" className="text-sm font-semibold text-[var(--ds-text)]">
          Payments
        </h3>
        {payments.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ds-text-secondary)]">No payments recorded.</p>
        ) : (
          <div className="ds-table-wrap mt-4" tabIndex={0} role="region" aria-label="Customer payment records table">
            <table className="ds-table min-w-[680px]">
              <caption className="sr-only">Customer payment records</caption>
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
                {payments.map((payment) => (
                  <tr key={payment.paymentId}>
                    <td className="ds-mono whitespace-nowrap">{payment.paymentDate}</td>
                    <td className="ds-mono whitespace-nowrap font-medium text-[var(--ds-text)]">
                      {payment.currency} {payment.amount}
                    </td>
                    <td className="whitespace-nowrap">{payment.paymentMethod}</td>
                    <td className="text-[var(--ds-text-secondary)]">{payment.paymentReference || "—"}</td>
                    <td>
                      <Badge variant={payment.paymentStatus === "RECORDED" ? "success" : "neutral"} light>
                        {payment.paymentStatus}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {subscriptions.length > 0 && (
          <div className="mt-5 rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] p-4">
            <p className="text-xs leading-5 text-[var(--ds-text-secondary)]">
              Recording a payment does not change subscription status. Payments cannot be edited or deleted.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="ds-label">Subscription</span>
                <select
                  className={`${inputClass} mt-2`}
                  value={paymentSubId}
                  onChange={(event) => {
                    setPaymentSubId(event.target.value);
                    const plan = subscriptions.find(
                      (item) => item.subscriptionId === event.target.value
                    );
                    if (plan) setPayAmount(plan.planPrice);
                  }}
                >
                  {subscriptions.map((subscription) => (
                    <option key={subscription.subscriptionId} value={subscription.subscriptionId}>
                      {subscription.planName} · {subscription.startDate} → {subscription.endDate}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="ds-label">Amount</span>
                <input
                  className={`${inputClass} mt-2 ds-mono`}
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(event) => setPayAmount(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="ds-label">Method</span>
                <input
                  className={`${inputClass} mt-2`}
                  value={payMethod}
                  maxLength={40}
                  onChange={(event) => setPayMethod(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="ds-label">Reference</span>
                <input
                  className={`${inputClass} mt-2`}
                  value={payReference}
                  maxLength={120}
                  onChange={(event) => setPayReference(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="ds-label">Payment date (IST)</span>
                <input
                  className={`${inputClass} mt-2 ds-mono`}
                  type="date"
                  value={payDate}
                  onChange={(event) => setPayDate(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="ds-label">Notes</span>
                <input
                  className={`${inputClass} mt-2`}
                  value={payNotes}
                  maxLength={1000}
                  onChange={(event) => setPayNotes(event.target.value)}
                />
              </label>
            </div>
            <Button size="md" light className="mt-4" loading={busy === "payment"} onClick={recordPayment}>
              Record payment
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
