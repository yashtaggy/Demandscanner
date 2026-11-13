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
        await adminRequest(
          `/api/admin/subscription-plans/${editing}`,
          "PATCH",
          body
        );
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
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">
            Subscription plans
          </h2>
          <p className="text-xs text-slate-500">
            Plans are deactivated, never deleted. Existing subscriptions keep
            their plan.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={startCreate}>
          New plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-slate-500">
          No plans yet. Create one before assigning a subscription.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-700/50">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Duration</th>
                <th className="py-2 pr-3 font-medium">Price</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {plans.map((plan) => (
                <tr
                  key={plan.planId}
                  className="border-b border-slate-800/60 last:border-0"
                >
                  <td className="py-2 pr-3">
                    <p className="text-slate-200">{plan.name}</p>
                    {plan.description && (
                      <p className="text-slate-600">{plan.description}</p>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {plan.durationDays} days
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {plan.currency} {plan.price}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge
                      variant={plan.status === "ACTIVE" ? "success" : "neutral"}
                    >
                      {plan.status}
                    </Badge>
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEdit(plan)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
          <p className="text-xs font-medium text-slate-300">
            {editing === "new" ? "Create plan" : "Edit plan"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-600">
                Name
              </span>
              <input
                className={inputClass}
                value={draft.name}
                maxLength={120}
                onChange={(event) => set("name", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-600">
                Duration (days)
              </span>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={3660}
                value={draft.durationDays}
                onChange={(event) => set("durationDays", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-600">
                Price
              </span>
              <input
                className={inputClass}
                inputMode="decimal"
                value={draft.price}
                onChange={(event) => set("price", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-600">
                Currency
              </span>
              <input
                className={inputClass}
                value={draft.currency}
                maxLength={3}
                onChange={(event) =>
                  set("currency", event.target.value.toUpperCase())
                }
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-600">
                Description
              </span>
              <input
                className={inputClass}
                value={draft.description}
                maxLength={2000}
                onChange={(event) => set("description", event.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-600">
                Status
              </span>
              <select
                className={inputClass}
                value={draft.status}
                onChange={(event) =>
                  set("status", event.target.value as SubscriptionPlanStatus)
                }
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => void submit()}>
              {editing === "new" ? "Create plan" : "Save changes"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
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
        </div>
      )}
    </section>
  );
}
