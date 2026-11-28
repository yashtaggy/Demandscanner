"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminRequest, inputClass } from "@/components/admin/admin-client";
import type {
  SubscriptionPlan,
  SubscriptionPlanStatus,
} from "@/lib/subscriptions/types";

interface Draft {
  name: string;
  description: string;
  durationDays: string;
  price: string;
  currency: string;
  status: SubscriptionPlanStatus;
}

function emptyDraft(): Draft {
  return {
    name: "",
    description: "",
    durationDays: "30",
    price: "0.00",
    currency: "INR",
    status: "ACTIVE",
  };
}

export function PlansPanel({
  plans,
  onRefresh,
}: {
  plans: SubscriptionPlan[];
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function startCreate() {
    setEditing("new");
    setDraft(emptyDraft());
    setError(null);
  }

  function startEdit(plan: SubscriptionPlan) {
    setEditing(plan.planId);
    setDraft({
      name: plan.name,
      description: plan.description ?? "",
      durationDays: String(plan.durationDays),
      price: plan.price,
      currency: plan.currency,
      status: plan.status,
    });
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: draft.name,
        description: draft.description,
        durationDays: Number(draft.durationDays),
        price: draft.price,
        currency: draft.currency,
        status: draft.status,
      };
      if (editing === "new") {
        await adminRequest("/api/admin/subscription-plans", "POST", body);
      } else if (editing) {
        await adminRequest(`/api/admin/subscription-plans/${editing}`, "PATCH", body);
      }
      setEditing(null);
      setDraft(emptyDraft());
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ds-panel overflow-hidden" aria-labelledby="plans-title">
      <div className="flex flex-col gap-4 border-b border-[var(--ds-border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="ds-label">Catalog</p>
          <h2 id="plans-title" className="mt-2 text-lg font-semibold text-[var(--ds-text)]">
            Subscription plans
          </h2>
          <p className="mt-1.5 text-sm text-[var(--ds-text-secondary)]">
            Plans are deactivated, never deleted. Existing subscriptions keep their plan.
          </p>
        </div>
        <Button size="sm" variant="secondary" light onClick={startCreate}>
          New plan
        </Button>
      </div>

      <div className="p-3 sm:p-5">
        {plans.length === 0 ? (
          <div className="ds-empty border-0 bg-transparent py-8">
            <p className="text-sm font-semibold text-[var(--ds-text)]">No plans yet.</p>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Create one before assigning a subscription.
            </p>
          </div>
        ) : (
          <div className="ds-table-wrap" tabIndex={0} role="region" aria-label="Subscription plans table">
            <table className="ds-table min-w-[680px]">
              <caption className="sr-only">Subscription plans</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Price</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.planId}>
                    <td>
                      <p className="font-medium text-[var(--ds-text)]">{plan.name}</p>
                      {plan.description && (
                        <p className="mt-1 max-w-md text-[var(--ds-text-secondary)]">{plan.description}</p>
                      )}
                    </td>
                    <td className="ds-mono whitespace-nowrap">{plan.durationDays} days</td>
                    <td className="ds-mono whitespace-nowrap font-medium text-[var(--ds-text)]">
                      {plan.currency} {plan.price}
                    </td>
                    <td>
                      <Badge variant={plan.status === "ACTIVE" ? "success" : "neutral"} light>
                        {plan.status}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" light onClick={() => startEdit(plan)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <form
          className="space-y-5 border-t border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] p-5 sm:p-7"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <p className="ds-label">Plan editor</p>
            <h3 className="mt-2 text-base font-semibold text-[var(--ds-text)]">
              {editing === "new" ? "Create plan" : "Edit plan"}
            </h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="ds-label">Name</span>
              <input
                className={`${inputClass} mt-2`}
                value={draft.name}
                maxLength={120}
                onChange={(event) => set("name", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ds-label">Duration (days)</span>
              <input
                className={`${inputClass} mt-2`}
                type="number"
                min={1}
                max={3660}
                value={draft.durationDays}
                onChange={(event) => set("durationDays", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ds-label">Price</span>
              <input
                className={`${inputClass} mt-2 ds-mono`}
                inputMode="decimal"
                value={draft.price}
                onChange={(event) => set("price", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ds-label">Currency</span>
              <input
                className={`${inputClass} mt-2 ds-mono`}
                value={draft.currency}
                maxLength={3}
                onChange={(event) => set("currency", event.target.value.toUpperCase())}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="ds-label">Description</span>
              <input
                className={`${inputClass} mt-2`}
                value={draft.description}
                maxLength={2000}
                onChange={(event) => set("description", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="ds-label">Status</span>
              <select
                className={`${inputClass} mt-2`}
                value={draft.status}
                onChange={(event) => set("status", event.target.value as SubscriptionPlanStatus)}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>
          </div>

          {error && (
            <p className="ds-alert ds-alert-negative" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="md" light type="submit" loading={busy}>
              {editing === "new" ? "Create plan" : "Save changes"}
            </Button>
            <Button
              size="md"
              variant="ghost"
              light
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setDraft(emptyDraft());
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
