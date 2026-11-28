"use client";

import { useState } from "react";
import Link from "next/link";
import { OverviewShell } from "@/components/overview/app-shell";
import { Button } from "@/components/ui/button";
import { SignalComposer } from "@/components/admin/signal-composer";
import { SignalHistory } from "@/components/admin/signal-history";
import { useAppAuth } from "@/hooks/use-app-auth";
import { canManageSignals } from "@/lib/navigation";

export default function AdminSignalsPage() {
  const { user, loading } = useAppAuth();
  const allowed = canManageSignals(user?.role);
  const [historyKey, setHistoryKey] = useState(0);

  return (
    <OverviewShell lastRefreshed={null}>
      <main className="mx-auto w-full max-w-[1280px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="border-b border-[var(--ds-border)] pb-6">
          <p className="ds-label">Super administrator</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)] sm:text-3xl">
            Signal workspace
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ds-text-secondary)]">
            Publish messages to customer inboxes and review publication, delivery and read state.
          </p>
        </header>

        {loading ? (
          <div className="space-y-4" aria-label="Loading signal administration">
            <div className="ds-skeleton h-72" />
            <div className="ds-skeleton h-48" />
          </div>
        ) : !user ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Sign in with a super administrator account
            </h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Signal publishing is restricted to authorized super administrators.
            </p>
            <Button
              variant="primary"
              size="md"
              light
              className="mt-5"
              onClick={() => {
                window.location.assign(
                  new URL("/login?next=%2Fadmin%2Fsignals", window.location.origin).toString()
                );
              }}
            >
              Sign in
            </Button>
          </div>
        ) : !allowed ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Super administrator access required
            </h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Publishing and reviewing signals is limited to super administrators.
            </p>
            {user.role === "ADMIN" && (
              <Link
                className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ds-gold-700)] underline decoration-[var(--ds-gold-500)] underline-offset-4"
                href="/admin/customers"
              >
                Go to customer administration →
              </Link>
            )}
          </div>
        ) : (
          <>
            <SignalComposer onPublished={() => setHistoryKey((key) => key + 1)} />
            <SignalHistory key={historyKey} />
          </>
        )}
      </main>
    </OverviewShell>
  );
}
