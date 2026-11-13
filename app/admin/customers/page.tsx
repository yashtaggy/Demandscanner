"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomersPanel } from "@/components/admin/customers-panel";
import { PlansPanel } from "@/components/admin/subscription-plans-panel";
import { adminRequest, inputClass } from "@/components/admin/admin-client";
import { useAppAuth } from "@/hooks/use-app-auth";
import type { SubscriptionPlan } from "@/lib/subscriptions/types";

async function requestPlans(): Promise<SubscriptionPlan[]> {
  const data = await adminRequest<{ plans: SubscriptionPlan[] }>(
    "/api/admin/subscription-plans",
    "GET"
  );
  return data.plans;
}

export default function AdminConsolePage() {
  const { user, loading } = useAppAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    try {
      setPlans(await requestPlans());
      setPlansError(null);
    } catch (err) {
      setPlansError(
        err instanceof Error ? err.message : "Could not load plans"
      );
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    requestPlans().then(
      (list) => {
        if (!active) return;
        setPlans(list);
        setPlansError(null);
      },
      (err: unknown) => {
        if (!active) return;
        setPlansError(
          err instanceof Error ? err.message : "Could not load plans"
        );
      }
    );
    return () => {
      active = false;
    };
  }, [isAdmin]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={null} />

      <main className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            Subscription administration
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Admin-created accounts, plans, subscriptions and manual payments.
            Every change is written to the audit log.
          </p>
        </div>

        {loading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-slate-800/40" />
        ) : !user ? (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Sign in with an administrator account
            </h2>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => {
                window.location.assign(
                  new URL(
                    "/login?next=%2Fadmin%2Fcustomers",
                    window.location.origin
                  ).toString()
                );
              }}
            >
              Sign in
            </Button>
          </div>
        ) : !isAdmin ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Not authorized
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Subscription administration is limited to administrators.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="info">{user.role}</Badge>
              <span className="text-xs text-slate-500">{user.email}</span>
            </div>

            <ProvisionCustomerCard />

            {plansError && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">
                {plansError}
              </p>
            )}

            <PlansPanel plans={plans} onRefresh={loadPlans} />
            <CustomersPanel plans={plans} />
          </>
        )}
      </main>
    </div>
  );
}

function ProvisionCustomerCard() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function provision() {
    setBusy(true);
    setError(null);
    setResetLink(null);
    setCreated(null);
    try {
      const data = await adminRequest<{
        user: { email: string };
        resetLink: string;
      }>("/api/admin/customers", "POST", {
        email,
        displayName: displayName || undefined,
      });
      setCreated(data.user.email);
      setResetLink(data.resetLink);
      setEmail("");
      setDisplayName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provisioning failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Add customer</h2>
        <p className="text-xs text-slate-500">
          Creates a passwordless Firebase account. Share the one-time reset link
          with the customer; it is not stored and cannot be shown again.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void provision();
        }}
      >
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-600">
            Email
          </span>
          <input
            className={`${inputClass} w-64`}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-600">
            Display name
          </span>
          <input
            className={`${inputClass} w-56`}
            value={displayName}
            maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <Button size="sm" type="submit" loading={busy} disabled={!email.trim()}>
          Create customer
        </Button>
      </form>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {created && resetLink && (
        <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-xs text-emerald-300">
            Account created for {created}. Share this reset link once:
          </p>
          <code className="block break-all rounded bg-slate-900/70 px-3 py-2 text-[11px] text-slate-300">
            {resetLink}
          </code>
          <p className="text-[11px] text-slate-500">
            Then assign a plan and activate the subscription below.
          </p>
        </div>
      )}
    </section>
  );
}
