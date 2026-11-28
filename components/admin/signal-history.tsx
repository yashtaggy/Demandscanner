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
    <section className="ds-panel overflow-hidden" aria-labelledby="history-title" aria-busy={loading}>
      <div className="flex flex-col gap-4 border-b border-[var(--ds-border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="ds-label">Publication log</p>
          <h2 id="history-title" className="mt-2 text-lg font-semibold text-[var(--ds-text)]">
            Signal history
          </h2>
          <p className="mt-1.5 text-sm text-[var(--ds-text-secondary)]">
            Newest first. Delivery counts come from stored recipient records.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          light
          loading={loading}
          onClick={() => {
            setLoading(true);
            setReloadKey((key) => key + 1);
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
              onClick={() => {
                setLoading(true);
                setReloadKey((key) => key + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : loading && signals.length === 0 ? (
          <div className="space-y-3" aria-label="Loading signal history">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="ds-skeleton h-36" />
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="ds-empty border-0 bg-transparent py-10">
            <p className="text-sm font-semibold text-[var(--ds-text)]">No signals have been published yet.</p>
            <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
              Published signals will appear here with their delivery summary.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {signals.map((signal) => (
              <li
                key={signal.signalId}
                className="rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] p-4 sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="ds-mono text-[11px] text-[var(--ds-text-secondary)]">
                      {formatDateTime(signal.publishedAt)}
                    </p>
                    <p className="mt-2 line-clamp-2 break-words text-sm font-medium leading-6 text-[var(--ds-text)]">
                      {signal.messagePreview || "(empty message)"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <Badge variant={signalStatusVariant(signal.status)} light>
                      {signal.status}
                    </Badge>
                    <Link
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ds-gold-700)] underline decoration-[var(--ds-gold-500)] underline-offset-4"
                      href={`/admin/signals/${signal.signalId}`}
                    >
                      View <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--ds-border)] pt-4">
                  <Badge variant="neutral" light>Recipients {signal.recipientCount}</Badge>
                  <Badge variant="neutral" light>Pending {signal.delivery.pending}</Badge>
                  <Badge variant="info" light>Sending {signal.delivery.sending}</Badge>
                  <Badge variant="success" light>Sent {signal.delivery.sent}</Badge>
                  <Badge variant={signal.delivery.failed > 0 ? "danger" : "neutral"} light>
                    Failed {signal.delivery.failed}
                  </Badge>
                  <Badge variant={signal.delivery.skipped > 0 ? "warning" : "neutral"} light>
                    Skipped {signal.delivery.skipped}
                  </Badge>
                  <span className="ds-mono self-center text-[11px] text-[var(--ds-text-secondary)]">
                    Read {signal.read.read} · Unread {signal.read.unread}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!error && total > 0 && (
        <div className="flex flex-col gap-3 border-t border-[var(--ds-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <span className="ds-mono text-xs text-[var(--ds-text-secondary)]" role="status">
            Showing {firstShown}–{lastShown} of {total}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              light
              disabled={page <= 1 || loading}
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              Previous
            </Button>
            <span className="ds-mono px-1 text-xs text-[var(--ds-text-secondary)]">
              Page {page} of {pageCount}
            </span>
            <Button
              size="sm"
              variant="secondary"
              light
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
