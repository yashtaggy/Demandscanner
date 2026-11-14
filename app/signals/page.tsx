"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={null} />

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Signals</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Messages published to your account, newest first.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3" aria-label="Loading signals">
            <div className="h-20 animate-pulse rounded-2xl bg-slate-800/40" />
            <div className="h-20 animate-pulse rounded-2xl bg-slate-800/30" />
          </div>
        ) : !user ? (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 px-6 py-10 text-center">
            <h2 className="text-base font-semibold text-slate-100">
              Sign in to view your signals
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
            {user.role === "SUPER_ADMIN" && (
              <Link
                className="mt-4 inline-block text-xs text-indigo-300 hover:text-indigo-200"
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
    </div>
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
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Inbox</h2>
          {unreadCount > 0 && (
            <Badge variant="info">{unreadCount} unread</Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
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

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="text-xs text-rose-300">{error}</p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => void loadFirst()}
          >
            Try again
          </Button>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="space-y-2" aria-label="Loading signals">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-xl bg-slate-800/40"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-700/40 p-6 text-center">
          <p className="text-sm text-slate-400">No signals yet.</p>
          <p className="mt-1 text-xs text-slate-600">
            New messages from your administrator will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((signal) => (
            <li key={signal.signalId}>
              <Link
                href={`/signals/${signal.signalId}`}
                className={`block rounded-xl border p-4 transition-colors hover:border-indigo-500/40 hover:bg-slate-800/60 ${
                  signal.isRead
                    ? "border-slate-700/40 bg-slate-900/30"
                    : "border-indigo-500/30 bg-indigo-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {!signal.isRead && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400"
                          aria-label="Unread"
                        />
                      )}
                      <p
                        className={`line-clamp-2 break-words text-sm ${
                          signal.isRead
                            ? "text-slate-300"
                            : "font-medium text-slate-100"
                        }`}
                      >
                        {signal.messagePreview || "(empty message)"}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-slate-500">
                      {formatDateTime(signal.publishedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {signal.isRead ? "Read" : "Unread"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {moreError && <p className="text-xs text-rose-400">{moreError}</p>}

      {!error && items.length > 0 && items.length < total && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="secondary"
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
