"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signalsRequest } from "@/components/signals/signals-client";
import { useAppAuth } from "@/hooks/use-app-auth";
import { canOpenSignalsInbox } from "@/lib/navigation";
import type {
  CustomerReadState,
  CustomerSignalDetail,
} from "@/lib/signals/types";
import { UNREAD_REFRESH_EVENT } from "@/lib/signals/ui";
import { formatDateTime } from "@/lib/utils";

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function SignalDetailPage() {
  const { user, loading } = useAppAuth();
  const params = useParams<{ signalId: string | string[] }>();
  const signalId = typeof params.signalId === "string" ? params.signalId : "";
  const allowed = canOpenSignalsInbox(user?.role);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={null} />

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
        <Link className="text-xs text-indigo-300 hover:text-indigo-200" href="/signals">
          ← Back to signals
        </Link>

        {loading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-slate-800/40" />
        ) : !user ? (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Sign in to view this signal
            </h2>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => {
                window.location.assign(
                  new URL("/login?next=%2Fsignals", window.location.origin).toString()
                );
              }}
            >
              Sign in
            </Button>
          </div>
        ) : !allowed ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Signals is a customer inbox
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Administrative accounts do not receive customer signals.
            </p>
          </div>
        ) : (
          <CustomerSignalView signalId={signalId} />
        )}
      </main>
    </div>
  );
}

function CustomerSignalView({ signalId }: { signalId: string }) {
  const [signal, setSignal] = useState<CustomerSignalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const autoMarkedFor = useRef<string | null>(null);

  const updateRead = useCallback(
    async (isRead: boolean) => {
      setReadBusy(true);
      setReadError(null);
      try {
        const data = await signalsRequest<{ signal: CustomerReadState }>(
          `/api/signals/${signalId}/read`,
          "PATCH",
          { isRead }
        );
        setSignal((current) =>
          current
            ? {
                ...current,
                readAt: data.signal.readAt,
                isRead: data.signal.isRead,
              }
            : current
        );
        window.dispatchEvent(new Event(UNREAD_REFRESH_EVENT));
      } catch (err) {
        setReadError(messageFor(err, "Could not update read status."));
      } finally {
        setReadBusy(false);
      }
    },
    [signalId]
  );

  useEffect(() => {
    let active = true;
    signalsRequest<{ signal: CustomerSignalDetail }>(
      `/api/signals/${signalId}`,
      "GET"
    ).then(
      (data) => {
        if (!active) return;
        setSignal(data.signal);
        setError(null);
        setLoading(false);
        if (!data.signal.isRead && autoMarkedFor.current !== signalId) {
          autoMarkedFor.current = signalId;
          void updateRead(true);
        }
      },
      (err: unknown) => {
        if (!active) return;
        setError(messageFor(err, "Could not load this signal"));
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, [signalId, updateRead]);

  if (loading) {
    return (
      <div className="space-y-3" aria-label="Loading signal">
        <div className="h-48 animate-pulse rounded-2xl bg-slate-800/40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4">
        <p className="text-sm text-rose-300">{error}</p>
        <p className="mt-1 text-xs text-slate-500">
          The signal may have been removed, or it is not assigned to your
          account.
        </p>
        <Link
          className="mt-3 inline-block text-xs text-indigo-300 hover:text-indigo-200"
          href="/signals"
        >
          Return to inbox
        </Link>
      </div>
    );
  }

  if (!signal) return null;

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-600">
            Published
          </p>
          <p className="text-sm tabular-nums text-slate-200">
            {formatDateTime(signal.publishedAt)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {signal.readAt
              ? `Read ${formatDateTime(signal.readAt)}`
              : "Not read yet"}
          </p>
        </div>
        <Badge variant={signal.isRead ? "neutral" : "info"}>
          {signal.isRead ? "Read" : "Unread"}
        </Badge>
      </div>

      <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3 text-sm text-slate-200 whitespace-pre-wrap break-words">
        {signal.message}
      </div>

      {readError && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
          {readError} The status shown above is the last confirmed state.
        </p>
      )}

      <div>
        <Button
          size="sm"
          variant="secondary"
          loading={readBusy}
          onClick={() => void updateRead(!signal.isRead)}
        >
          {signal.isRead ? "Mark as unread" : "Mark as read"}
        </Button>
      </div>
    </section>
  );
}
