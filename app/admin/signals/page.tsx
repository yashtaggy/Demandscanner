"use client";

import { useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={null} />

      <main className="mx-auto max-w-screen-lg px-4 py-6 sm:px-6 space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Signals</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Publish messages to customer inboxes and review publication,
            delivery and read state.
          </p>
        </div>

        {loading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-slate-800/40" />
        ) : !user ? (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Sign in with a super administrator account
            </h2>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => {
                window.location.assign(
                  new URL("/login?next=%2Fadmin%2Fsignals", window.location.origin)
                    .toString()
                );
              }}
            >
              Sign in
            </Button>
          </div>
        ) : !allowed ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Super administrator access required
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Publishing and reviewing signals is limited to super
              administrators.
            </p>
            {user.role === "ADMIN" && (
              <Link
                className="mt-4 inline-block text-xs text-indigo-300 hover:text-indigo-200"
                href="/admin/customers"
              >
                Go to customer administration →
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="info">{user.role}</Badge>
              <span className="text-xs text-slate-500">{user.email}</span>
            </div>

            <SignalComposer onPublished={() => setHistoryKey((key) => key + 1)} />
            <SignalHistory key={historyKey} />
          </>
        )}
      </main>
    </div>
  );
}
