"use client";

import { useCallback, useEffect, useState } from "react";
import { OverviewShell } from "@/components/overview/app-shell";
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
      setPlansError(err instanceof Error ? err.message : "Could not load plans");
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
        setPlansError(err instanceof Error ? err.message : "Could not load plans");
      }
    );
    return () => {
      active = false;
    };
  }, [isAdmin]);

  return (
    <OverviewShell lastRefreshed={null}>
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="border-b border-[var(--ds-border)] pb-6">
          <p className="ds-label">Admin console</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)] sm:text-3xl">
            Customer administration
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ds-text-secondary)]">
            Admin-created accounts, plans, subscriptions and manual payments. Every change is written to the audit log.
          </p>
        </header>

        {loading ? (
          <div className="space-y-4" aria-label="Loading administration console">
            <div className="ds-skeleton h-56" />
            <div className="ds-skeleton h-48" />
          </div>
        ) : !user ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Sign in with an administrator account
            </h2>
            <Button
              variant="primary"
              size="md"
              light
              className="mt-5"
              onClick={() => {
                window.location.assign(
                  new URL("/login?next=%2Fadmin%2Fcustomers", window.location.origin).toString()
                );
              }}
            >
              Sign in
            </Button>
          </div>
        ) : !isAdmin ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">Not authorized</h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Subscription administration is limited to administrators.
            </p>
          </div>
        ) : (
          <>
            <ProvisionCustomerCard />

            {plansError && (
              <p className="ds-alert ds-alert-negative" role="alert">
                {plansError}
              </p>
            )}

            <PlansPanel plans={plans} onRefresh={loadPlans} />
            <CustomersPanel plans={plans} />
          </>
        )}
      </main>
    </OverviewShell>
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
    <section className="ds-panel p-5 sm:p-7" aria-labelledby="add-customer-title">
      <div className="border-b border-[var(--ds-border)] pb-5">
        <h2 id="add-customer-title" className="text-lg font-semibold text-[var(--ds-text)]">
          Add customer
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ds-text-secondary)]">
          Creates a passwordless Firebase account. Share the one-time reset link with the customer; it is not stored and cannot be shown again.
        </p>
      </div>

      <form
        className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void provision();
        }}
      >
        <label className="block">
          <span className="ds-label">Email</span>
          <input
            className={`${inputClass} mt-2`}
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="ds-label">Display name</span>
          <input
            className={`${inputClass} mt-2`}
            value={displayName}
            maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <Button size="md" light type="submit" loading={busy} disabled={!email.trim()}>
          Create customer
        </Button>
      </form>

      {error && (
        <p className="ds-alert ds-alert-negative mt-4" role="alert">
          {error}
        </p>
      )}

      {created && resetLink && (
        <div className="ds-alert ds-alert-positive mt-5" role="status">
          <p className="font-semibold">Account created for {created}. Share this reset link once:</p>
          <code className="mt-3 block break-all rounded-[var(--ds-radius-sm)] border border-[color-mix(in_srgb,var(--ds-positive)_20%,transparent)] bg-[var(--ds-surface-elevated)] px-3 py-3 text-[11px] leading-5 text-[var(--ds-text)]">
            {resetLink}
          </code>
          <p className="mt-3">Then assign a plan and activate the subscription below.</p>
        </div>
      )}
    </section>
  );
}
