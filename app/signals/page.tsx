"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OverviewShell } from "@/components/overview/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signalsRequest } from "@/components/signals/signals-client";
import { useAppAuth } from "@/hooks/use-app-auth";
import { canOpenSignalsInbox } from "@/lib/navigation";
import type {
  CustomerSignalInbox,
  CustomerSignalSummary,
} from "@/lib/signals/types";
import { appendInboxPage, UNREAD_REFRESH_EVENT } from "@/lib/signals/ui";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 20;

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function SignalsInboxPage() {
  const { user, loading } = useAppAuth();
  const allowed = canOpenSignalsInbox(user?.role);

  return (
    <OverviewShell lastRefreshed={null}>
      <main className="mx-auto w-full max-w-[1280px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--ds-border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="ds-label">Customer workspace</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)] sm:text-3xl">
              Signals
            </h1>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Messages published to your account, newest first.
            </p>
          </div>
          <p className="ds-mono text-xs text-[var(--ds-text-secondary)]">Asia/Kolkata</p>
        </header>

        {loading ? (
          <div className="space-y-3" aria-label="Loading signals">
            <div className="ds-skeleton h-24" />
            <div className="ds-skeleton h-24" />
          </div>
        ) : !user ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Sign in to view your signals
            </h2>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Your administrator-published messages are available after sign-in.
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
            {user.role === "SUPER_ADMIN" && (
              <Link
                className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ds-gold-700)] underline decoration-[var(--ds-gold-500)] underline-offset-4"
                href="/admin/signals"
              >
                Go to signal administration →
              </Link>
            )}
          </div>
        ) : (
          <SignalInbox />
        )}
      </main>
    </OverviewShell>
  );
}

function SignalInbox() {
  const [items, setItems] = useState<CustomerSignalSummary[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);

  const loadFirst = useCallback(async () => {
    try {
      const data = await signalsRequest<CustomerSignalInbox>(
        `/api/signals?page=1&pageSize=${PAGE_SIZE}`,
        "GET"
      );
      setItems(data.signals);
      setPage(1);
      setTotal(data.total);
      setUnreadCount(data.unreadCount);
      setError(null);
    } catch (err) {
      setError(messageFor(err, "Could not load your signals"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    signalsRequest<CustomerSignalInbox>(
      `/api/signals?page=1&pageSize=${PAGE_SIZE}`,
      "GET"
    ).then(
      (data) => {
        if (!active) return;
        setItems(data.signals);
        setPage(1);
        setTotal(data.total);
        setUnreadCount(data.unreadCount);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!active) return;
        setError(messageFor(err, "Could not load your signals"));
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refresh = () => void loadFirst();
    window.addEventListener(UNREAD_REFRESH_EVENT, refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener(UNREAD_REFRESH_EVENT, refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [loadFirst]);

  async function loadMore() {
    if (loadingMore || loading) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const data = await signalsRequest<CustomerSignalInbox>(
        `/api/signals?page=${page + 1}&pageSize=${PAGE_SIZE}`,
        "GET"
      );
      setItems((current) => appendInboxPage(current, data.signals));
      setPage((current) => current + 1);
      setTotal(data.total);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      setMoreError(messageFor(err, "Could not load more signals"));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="ds-panel overflow-hidden" aria-labelledby="inbox-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-border)] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="inbox-title" className="text-sm font-semibold text-[var(--ds-text)]">
            Inbox
          </h2>
          {unreadCount > 0 && (
            <span aria-live="polite">
              <Badge variant="info" light dot>
                {unreadCount} unread
              </Badge>
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          light
          loading={loading}
          onClick={() => {
            setLoading(true);
            setMoreError(null);
            void loadFirst();
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="p-3 sm:p-5">
        {error ? (
          <div className="ds-alert ds-alert-negative" role="alert">
            <p>{error}</p>
            <Button
              size="sm"
              variant="ghost"
              light
              className="mt-3"
              onClick={() => void loadFirst()}
            >
              Try again
            </Button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="space-y-3" aria-label="Loading signals">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="ds-skeleton h-24" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="ds-empty border-0 bg-transparent px-4 py-12">
            <p className="text-sm font-semibold text-[var(--ds-text)]">No signals yet.</p>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              New messages from your administrator will appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((signal) => (
              <li key={signal.signalId}>
                <Link
                  href={`/signals/${signal.signalId}`}
                  className={`group block min-h-[104px] rounded-[var(--ds-radius-md)] border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-gold-500)] focus-visible:ring-offset-2 sm:p-5 ${
                    signal.isRead
                      ? "border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] hover:bg-[var(--ds-surface-subtle)]"
                      : "border-[color-mix(in_srgb,var(--ds-gold-500)_55%,var(--ds-border))] bg-[var(--ds-gold-50)] hover:bg-[var(--ds-gold-100)]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                        signal.isRead
                          ? "bg-[var(--ds-border-strong)]"
                          : "bg-[var(--ds-gold-500)] ring-4 ring-[color-mix(in_srgb,var(--ds-gold-500)_14%,transparent)]"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <p
                          className={`line-clamp-3 break-words text-sm leading-6 sm:line-clamp-2 ${
                            signal.isRead
                              ? "text-[var(--ds-text-secondary)]"
                              : "font-semibold text-[var(--ds-text)]"
                          }`}
                        >
                          {signal.messagePreview || "(empty message)"}
                        </p>
                        <Badge variant={signal.isRead ? "neutral" : "warning"} light className="self-start">
                          {signal.isRead ? "Read" : "Unread"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <time
                          dateTime={signal.publishedAt}
                          className="ds-mono text-[11px] text-[var(--ds-text-secondary)]"
                        >
                          {formatDateTime(signal.publishedAt)}
                        </time>
                        <span className="text-xs font-medium text-[var(--ds-text-secondary)]">
                          Open signal <span aria-hidden="true">→</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {moreError && (
        <p className="ds-alert ds-alert-negative mx-3 mb-3 sm:mx-5" role="alert">
          {moreError}
        </p>
      )}

      {!error && items.length > 0 && items.length < total && (
        <div className="flex justify-center border-t border-[var(--ds-border)] px-4 py-4">
          <Button
            size="sm"
            variant="secondary"
            light
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            Load more ({total - items.length} remaining)
          </Button>
        </div>
      )}
    </section>
  );
}
