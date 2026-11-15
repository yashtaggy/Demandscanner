"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminRequest } from "@/components/admin/admin-client";
import type { SignalHistoryEntry } from "@/lib/signals/types";
import { signalStatusVariant } from "@/lib/signals/ui";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 10;

interface HistoryResponse {
  signals: SignalHistoryEntry[];
  page: number;
  pageSize: number;
  total: number;
}

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function SignalHistory() {
  const [page, setPage] = useState(1);
  const [signals, setSignals] = useState<SignalHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    adminRequest<HistoryResponse>(
      `/api/admin/signals?page=${page}&pageSize=${PAGE_SIZE}`,
      "GET"
    ).then(
      (data) => {
        if (!active) return;
        setSignals(data.signals);
        setTotal(data.total);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!active) return;
        setError(messageFor(err, "Could not load signal history"));
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, [page, reloadKey]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = (page - 1) * PAGE_SIZE + signals.length;

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">
            Signal history
          </h2>
          <p className="text-xs text-slate-500">
            Newest first. Delivery counts come from stored recipient records.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={loading}
          onClick={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
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
            onClick={() => {
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : loading && signals.length === 0 ? (
        <div className="space-y-2" aria-label="Loading signal history">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl bg-slate-800/40"
            />
          ))}
        </div>
      ) : signals.length === 0 ? (
        <p className="rounded-xl border border-slate-700/40 p-4 text-sm text-slate-500">
          No signals have been published yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {signals.map((signal) => (
            <li
              key={signal.signalId}
              className="rounded-xl border border-slate-700/40 bg-slate-900/30 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] tabular-nums text-slate-500">
                    {formatDateTime(signal.publishedAt)}
                  </p>
                  <p className="mt-1 line-clamp-2 break-words text-sm text-slate-200">
                    {signal.messagePreview || "(empty message)"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={signalStatusVariant(signal.status)}>
                    {signal.status}
                  </Badge>
                  <Link
                    className="text-xs text-indigo-300 hover:text-indigo-200"
                    href={`/admin/signals/${signal.signalId}`}
                  >
                    View
                  </Link>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge variant="neutral">
                  Recipients {signal.recipientCount}
                </Badge>
                <Badge variant="neutral">Pending {signal.delivery.pending}</Badge>
                <Badge variant="info">Sending {signal.delivery.sending}</Badge>
                <Badge variant="success">Sent {signal.delivery.sent}</Badge>
                <Badge
                  variant={signal.delivery.failed > 0 ? "danger" : "neutral"}
                >
                  Failed {signal.delivery.failed}
                </Badge>
                <Badge
                  variant={signal.delivery.skipped > 0 ? "warning" : "neutral"}
                >
                  Skipped {signal.delivery.skipped}
                </Badge>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  Read {signal.read.read} · Unread {signal.read.unread}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!error && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums text-slate-500">
            Showing {firstShown}–{lastShown} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              Previous
            </Button>
            <span className="text-[11px] tabular-nums text-slate-500">
              Page {page} of {pageCount}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= pageCount || loading}
              onClick={() => {
                setLoading(true);
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
