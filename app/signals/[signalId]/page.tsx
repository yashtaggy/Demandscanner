"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OverviewShell } from "@/components/overview/app-shell";
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
    <OverviewShell lastRefreshed={null}>
      <main className="mx-auto w-full max-w-[1024px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--ds-text-secondary)] hover:text-[var(--ds-text)]"
            href="/signals"
          >
            <span aria-hidden="true">←</span> Back to signals
          </Link>
          <p className="ds-label">Customer workspace</p>
        </div>

        <header className="border-b border-[var(--ds-border)] pb-6">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)] sm:text-3xl">
            Signal detail
          </h1>
          <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
            The complete message published to your account.
          </p>
        </header>

        {loading ? (
          <div className="space-y-4" aria-label="Loading signal">
            <div className="ds-skeleton h-36" />
            <div className="ds-skeleton h-56" />
          </div>
        ) : !user ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Sign in to view this signal
            </h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              This message is available only to the account it was assigned to.
            </p>
            <Button
              variant="primary"
              size="md"
              light
              className="mt-5"
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
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Signals is a customer inbox
            </h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Administrative accounts do not receive customer signals.
            </p>
          </div>
        ) : (
          <CustomerSignalView signalId={signalId} />
        )}
      </main>
    </OverviewShell>
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
      <div className="space-y-4" aria-label="Loading signal">
        <div className="ds-skeleton h-36" />
        <div className="ds-skeleton h-56" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ds-alert ds-alert-negative" role="alert">
        <p className="font-semibold">{error}</p>
        <p className="mt-2">
          The signal may have been removed, or it is not assigned to your account.
        </p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ds-negative)] underline underline-offset-4"
          href="/signals"
        >
          Return to inbox
        </Link>
      </div>
    );
  }

  if (!signal) return null;

  return (
    <article className="ds-panel overflow-hidden" aria-labelledby="signal-message-title">
      <div className="flex flex-col gap-5 border-b border-[var(--ds-border)] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-7 sm:py-6">
        <div>
          <h2 id="signal-message-title" className="text-lg font-semibold tracking-[-0.015em] text-[var(--ds-text)]">
            Published message
          </h2>
          <div className="mt-3 space-y-1.5">
            <p className="ds-mono text-xs text-[var(--ds-text-secondary)]">
              <span className="mr-2 text-[var(--ds-text-secondary)]">Published</span>
              {formatDateTime(signal.publishedAt)}
            </p>
            <p className="ds-mono text-xs text-[var(--ds-text-secondary)]">
              {signal.readAt
                ? `Read ${formatDateTime(signal.readAt)}`
                : "Not read yet"}
            </p>
          </div>
        </div>
        <Badge variant={signal.isRead ? "neutral" : "warning"} light dot className="self-start">
          {signal.isRead ? "Read" : "Unread"}
        </Badge>
      </div>

      <div className="px-5 py-6 sm:px-7 sm:py-8">
        <div className="rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-5 py-6 text-[15px] leading-7 text-[var(--ds-text)] whitespace-pre-wrap break-words sm:px-7 sm:py-8 sm:text-base sm:leading-8">
          {signal.message}
        </div>
      </div>

      {readError && (
        <p className="ds-alert ds-alert-warning mx-5 mb-5 sm:mx-7" role="alert">
          {readError} The status shown above is the last confirmed state.
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <p className="text-xs text-[var(--ds-text-secondary)]">
          Opening a signal marks it as read once.
        </p>
        <Button
          size="sm"
          variant="secondary"
          light
          loading={readBusy}
          onClick={() => void updateRead(!signal.isRead)}
        >
          {signal.isRead ? "Mark as unread" : "Mark as read"}
        </Button>
      </div>
    </article>
  );
}
