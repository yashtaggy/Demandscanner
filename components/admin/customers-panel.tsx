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
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Customers</h2>
          <p className="text-xs text-slate-500">
            Search by email or name. Entitlement is computed by the database
            for the current IST date.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
        >
          <input
            className={`${inputClass} w-64`}
            placeholder="Search email or name"
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button size="sm" variant="secondary" type="submit" loading={listLoading}>
            Search
          </Button>
        </form>
      </div>

      {listError && <p className="text-xs text-rose-400">{listError}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-slate-700/40">
          {customers.length === 0 && !listLoading ? (
            <p className="p-4 text-sm text-slate-500">No customers found.</p>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {customers.map((customer) => (
                <li key={customer.userId}>
                  <button
                    type="button"
                    onClick={() => select(customer.userId)}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-800/50 ${
                      selectedId === customer.userId ? "bg-slate-800/70" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-slate-200">
                        {customer.displayName || customer.email}
                      </span>
                      <Badge variant={customer.entitled ? "success" : "neutral"}>
                        {customer.entitled ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {customer.email}
                      </span>
                      {customer.subscription && (
                        <span className="shrink-0 text-[11px] text-slate-600 tabular-nums">
                          {customer.subscription.startDate} →{" "}
                          {customer.subscription.endDate}
                        </span>
                      )}
                    </div>
                    {customer.accountStatus !== "ACTIVE" && (
                      <p className="mt-1 text-[11px] text-rose-400">
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
            <div className="h-40 animate-pulse rounded-xl bg-slate-800/40" />
          ) : detailError ? (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
              {detailError}
            </p>
          ) : detail ? (
            <CustomerDetail
              detail={detail}
              plans={plans}
              onChanged={refreshSelected}
            />
          ) : (
            <p className="rounded-xl border border-slate-700/40 p-4 text-sm text-slate-500">
              Select a customer to view subscriptions and payments.
            </p>
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

  // Account suspension / reactivation
  const [statusReason, setStatusReason] = useState("");

  // Assign subscription
  const [assignPlanId, setAssignPlanId] = useState(
    activePlans[0]?.planId ?? ""
  );
  const [assignStart, setAssignStart] = useState(today);

  // Lifecycle action form
  const [action, setAction] = useState<{
    subscriptionId: string;
    kind: "ACTIVATE" | "EXTEND" | "CANCEL" | "RENEW";
  } | null>(null);
  const [actionDays, setActionDays] = useState("30");
  const [actionReason, setActionReason] = useState("");
  const [actionStart, setActionStart] = useState("");

  // Payment form
  const currentSubscription =
    subscriptions.find(
      (item) => item.status === "ACTIVE" && item.startDate <= today && item.endDate >= today
    ) ?? subscriptions[0] ?? null;
  const [paymentSubId, setPaymentSubId] = useState(
    currentSubscription?.subscriptionId ?? ""
  );
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
      <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-200">
              {customer.displayName || customer.email}
            </p>
            <p className="text-xs text-slate-500">{customer.email}</p>
            <p className="mt-1 text-[11px] text-slate-600 tabular-nums">
              Created {customer.createdAt.slice(0, 10)}
            </p>
          </div>
          <Badge
            variant={customer.accountStatus === "ACTIVE" ? "success" : "danger"}
          >
            Account {customer.accountStatus}
          </Badge>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <input
            className={`${inputClass} w-64`}
            placeholder="Reason for suspension or reactivation"
            value={statusReason}
            maxLength={500}
            onChange={(event) => setStatusReason(event.target.value)}
          />
          {customer.accountStatus === "ACTIVE" ? (
            <Button
              size="sm"
              variant="danger"
              loading={busy === "status-SUSPENDED"}
              onClick={() => changeAccountStatus("SUSPENDED")}
            >
              Suspend account
            </Button>
          ) : (
            <Button
              size="sm"
              variant="success"
              loading={busy === "status-ACTIVE"}
              onClick={() => changeAccountStatus("ACTIVE")}
            >
              Reactivate account
            </Button>
          )}
        </div>
        <p className="text-[11px] text-slate-600">
          Reactivating an account does not extend an expired subscription.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-4 space-y-3">
        <p className="text-xs font-medium text-slate-300">Assign subscription</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-600">
              Plan
            </span>
            <select
              className={`${inputClass} w-56`}
              value={assignPlanId}
              onChange={(event) => setAssignPlanId(event.target.value)}
            >
              {activePlans.length === 0 && (
                <option value="">No active plans</option>
              )}
              {activePlans.map((plan) => (
                <option key={plan.planId} value={plan.planId}>
                  {plan.name} · {plan.durationDays}d · {plan.currency} {plan.price}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-600">
              Start date (IST)
            </span>
            <input
              className={`${inputClass} w-40`}
              type="date"
              value={assignStart}
              onChange={(event) => setAssignStart(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={!assignPlanId}
            loading={busy === "assign"}
            onClick={assign}
          >
            Assign (pending)
          </Button>
        </div>
        <p className="text-[11px] text-slate-600">
          Assignment creates a PENDING subscription. Activate it explicitly to
          grant access.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-4 space-y-3">
        <p className="text-xs font-medium text-slate-300">Subscriptions</p>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-slate-500">No subscriptions yet.</p>
        ) : (
          <div className="space-y-2">
            {subscriptions.map((subscription) => (
              <div
                key={subscription.subscriptionId}
                className="rounded-lg border border-slate-800/80 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-slate-200">
                      {subscription.planName}{" "}
                      <span className="text-xs text-slate-500 tabular-nums">
                        {subscription.startDate} → {subscription.endDate}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Stored {subscription.status} · effective{" "}
                      {subscription.effectiveStatus}
                      {subscription.daysRemaining !== null
                        ? ` · ${subscription.daysRemaining} days left`
                        : ""}
                    </p>
                    {subscription.cancellationReason && (
                      <p className="mt-0.5 text-[11px] text-amber-400/80">
                        Cancelled: {subscription.cancellationReason}
                      </p>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[subscription.effectiveStatus]}>
                    {statusLabel(subscription.effectiveStatus)}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {subscription.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() =>
                        setAction({
                          subscriptionId: subscription.subscriptionId,
                          kind: "ACTIVATE",
                        })
                      }
                    >
                      Activate
                    </Button>
                  )}
                  {(subscription.status === "PENDING" ||
                    subscription.status === "ACTIVE") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setAction({
                          subscriptionId: subscription.subscriptionId,
                          kind: "EXTEND",
                        })
                      }
                    >
                      Extend
                    </Button>
                  )}
                  {subscription.status !== "CANCELLED" && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        setAction({
                          subscriptionId: subscription.subscriptionId,
                          kind: "CANCEL",
                        })
                      }
                    >
                      Cancel
                    </Button>
                  )}
                  {(subscription.status === "ACTIVE" ||
                    subscription.status === "EXPIRED") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setActionStart("");
                        setAction({
                          subscriptionId: subscription.subscriptionId,
                          kind: "RENEW",
                        });
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
          <div className="space-y-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
            <p className="text-xs text-indigo-300">{action.kind} subscription</p>
            {action.kind === "EXTEND" && (
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Additional days
                </span>
                <input
                  className={`${inputClass} w-32`}
                  type="number"
                  min={1}
                  max={3660}
                  value={actionDays}
                  onChange={(event) => setActionDays(event.target.value)}
                />
              </label>
            )}
            {action.kind === "CANCEL" && (
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Cancellation reason
                </span>
                <input
                  className={inputClass}
                  value={actionReason}
                  maxLength={500}
                  onChange={(event) => setActionReason(event.target.value)}
                />
              </label>
            )}
            {action.kind === "RENEW" && (
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Start date (leave empty to start the day after the current
                  end)
                </span>
                <input
                  className={`${inputClass} w-44`}
                  type="date"
                  value={actionStart}
                  onChange={(event) => setActionStart(event.target.value)}
                />
              </label>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={busy === `action-${action.kind}`}
                onClick={submitAction}
              >
                Confirm {action.kind.toLowerCase()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => setAction(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-4 space-y-3">
        <p className="text-xs font-medium text-slate-300">Payments</p>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Method</th>
                  <th className="py-2 pr-3 font-medium">Reference</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {payments.map((payment) => (
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
                    <td className="py-2">{payment.paymentStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {subscriptions.length > 0 && (
          <div className="space-y-2 rounded-lg border border-slate-800/80 p-3">
            <p className="text-[11px] text-slate-500">
              Recording a payment does not change subscription status. Payments
              cannot be edited or deleted.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Subscription
                </span>
                <select
                  className={inputClass}
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
                    <option
                      key={subscription.subscriptionId}
                      value={subscription.subscriptionId}
                    >
                      {subscription.planName} · {subscription.startDate} →{" "}
                      {subscription.endDate}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Amount
                </span>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(event) => setPayAmount(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Method
                </span>
                <input
                  className={inputClass}
                  value={payMethod}
                  maxLength={40}
                  onChange={(event) => setPayMethod(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Reference
                </span>
                <input
                  className={inputClass}
                  value={payReference}
                  maxLength={120}
                  onChange={(event) => setPayReference(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Payment date (IST)
                </span>
                <input
                  className={inputClass}
                  type="date"
                  value={payDate}
                  onChange={(event) => setPayDate(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-600">
                  Notes
                </span>
                <input
                  className={inputClass}
                  value={payNotes}
                  maxLength={1000}
                  onChange={(event) => setPayNotes(event.target.value)}
                />
              </label>
            </div>
            <Button
              size="sm"
              loading={busy === "payment"}
              onClick={recordPayment}
            >
              Record payment
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
