"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Header } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminRequest } from "@/components/admin/admin-client";
import { useAppAuth } from "@/hooks/use-app-auth";
import { canManageSignals } from "@/lib/navigation";
import type {
  RetryFailedResult,
  SignalDetail,
  SignalRecipientDetail,
} from "@/lib/signals/types";
import {
  emailStatusVariant,
  recipientSummaryLabel,
  signalStatusVariant,
} from "@/lib/signals/ui";
import { formatDateTime } from "@/lib/utils";

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function AdminSignalDetailPage() {
  const { user, loading } = useAppAuth();
  const params = useParams<{ signalId: string | string[] }>();
  const signalId = typeof params.signalId === "string" ? params.signalId : "";
  const allowed = canManageSignals(user?.role);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header lastRefreshed={null} />

      <main className="mx-auto max-w-screen-lg px-4 py-6 sm:px-6 space-y-6">
        <Link
          className="text-xs text-indigo-300 hover:text-indigo-200"
          href="/admin/signals"
        >
          ← Back to signals
        </Link>

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
              Signal details are limited to super administrators.
            </p>
          </div>
        ) : (
          <SignalDetailView signalId={signalId} />
        )}
      </main>
    </div>
  );
}

function SignalDetailView({ signalId }: { signalId: string }) {
  const [detail, setDetail] = useState<SignalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<RetryFailedResult | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminRequest<{ signal: SignalDetail }>(
        `/api/admin/signals/${signalId}`,
        "GET"
      );
      setDetail(data.signal);
      setError(null);
    } catch (err) {
      setError(messageFor(err, "Could not load this signal"));
    } finally {
      setLoading(false);
    }
  }, [signalId]);

  useEffect(() => {
    let active = true;
    adminRequest<{ signal: SignalDetail }>(
      `/api/admin/signals/${signalId}`,
      "GET"
    ).then(
      (data) => {
        if (!active) return;
        setDetail(data.signal);
        setError(null);
        setLoading(false);
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
  }, [signalId]);

  async function retryFailed() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    setRetryResult(null);
    try {
      const data = await adminRequest<{ retry: RetryFailedResult }>(
        `/api/admin/signals/${signalId}/retry`,
        "POST"
      );
      setRetryResult(data.retry);
      setConfirmRetry(false);
      await load();
    } catch (err) {
      setRetryError(messageFor(err, "Could not requeue failed recipients"));
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-label="Loading signal details">
        <div className="h-40 animate-pulse rounded-2xl bg-slate-800/40" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-800/30" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4">
        <p className="text-sm text-rose-300">{error}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => void load()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <>
      <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-600">
              Published
            </p>
            <p className="text-sm tabular-nums text-slate-200">
              {formatDateTime(detail.publishedAt)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Created {formatDateTime(detail.createdAt)}
              {detail.createdBy
                ? ` by ${detail.createdBy.displayName || detail.createdBy.email}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={signalStatusVariant(detail.status)}>
              {detail.status}
            </Badge>
            <Badge variant="neutral">
              {recipientSummaryLabel(detail.recipientCount)}
            </Badge>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3 text-sm text-slate-200 whitespace-pre-wrap break-words">
          {detail.message}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="neutral">Pending {detail.delivery.pending}</Badge>
          <Badge variant="info">Sending {detail.delivery.sending}</Badge>
          <Badge variant="success">Sent {detail.delivery.sent}</Badge>
          <Badge variant={detail.delivery.failed > 0 ? "danger" : "neutral"}>
            Failed {detail.delivery.failed}
          </Badge>
          <Badge variant={detail.delivery.skipped > 0 ? "warning" : "neutral"}>
            Skipped {detail.delivery.skipped}
          </Badge>
          <Badge variant="neutral">Read {detail.read.read}</Badge>
          <Badge variant="neutral">Unread {detail.read.unread}</Badge>
        </div>

        {detail.delivery.failed > 0 && (
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div>
              <p className="text-sm font-medium text-amber-200">
                {detail.delivery.failed} recipient
                {detail.delivery.failed === 1 ? "" : "s"} failed delivery
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Retrying resets still-active failed recipients to pending so a
                future dispatcher can attempt them again. It does not send email
                now.
              </p>
            </div>

            {retryResult && (
              <p className="text-xs text-emerald-300">
                {retryResult.retriedCount} recipient
                {retryResult.retriedCount === 1 ? "" : "s"} requeued.
                {retryResult.retriedCount === 0
                  ? " They may no longer be active customers."
                  : " No email has been sent."}
              </p>
            )}
            {retryError && <p className="text-xs text-rose-300">{retryError}</p>}

            {confirmRetry ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={retrying}
                  onClick={() => void retryFailed()}
                >
                  Confirm retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={retrying}
                  onClick={() => setConfirmRetry(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={retrying}
                onClick={() => {
                  setRetryError(null);
                  setRetryResult(null);
                  setConfirmRetry(true);
                }}
              >
                Retry failed recipients
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Recipients</h2>
          <span className="text-[11px] text-slate-500">
            Emails are the address recorded at publication time.
          </span>
        </div>

        {detail.recipients.length === 0 ? (
          <p className="text-sm text-slate-500">
            This signal has no recipient records.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-700/50">
                  <th className="py-2 pr-3 font-medium">Recipient</th>
                  <th className="py-2 pr-3 font-medium">Read</th>
                  <th className="py-2 pr-3 font-medium">Delivery</th>
                  <th className="py-2 pr-3 font-medium">Attempts</th>
                  <th className="py-2 pr-3 font-medium">Last attempt</th>
                  <th className="py-2 pr-3 font-medium">Sent</th>
                  <th className="py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {detail.recipients.map((recipient) => (
                  <RecipientRow key={recipient.recipientId} recipient={recipient} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function RecipientRow({ recipient }: { recipient: SignalRecipientDetail }) {
  return (
    <tr className="border-b border-slate-800/60 last:border-0 align-top">
      <td className="py-2 pr-3">
        <p className="text-slate-200">
          {recipient.displayName || recipient.email}
        </p>
        <p className="text-[11px] text-slate-500">{recipient.email}</p>
      </td>
      <td className="py-2 pr-3">
        {recipient.readAt ? (
          <span className="tabular-nums text-emerald-300">
            {formatDateTime(recipient.readAt)}
          </span>
        ) : (
          <span className="text-slate-500">Unread</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <Badge variant={emailStatusVariant(recipient.emailStatus)}>
          {recipient.emailStatus}
        </Badge>
      </td>
      <td className="py-2 pr-3 tabular-nums">{recipient.emailAttempts}</td>
      <td className="py-2 pr-3 tabular-nums text-slate-400">
        {recipient.emailLastAttemptAt
          ? formatDateTime(recipient.emailLastAttemptAt)
          : "—"}
      </td>
      <td className="py-2 pr-3 tabular-nums text-slate-400">
        {recipient.emailSentAt ? formatDateTime(recipient.emailSentAt) : "—"}
      </td>
      <td className="max-w-[16rem] py-2">
        {recipient.emailError ? (
          <span
            className="block truncate text-rose-300"
            title={recipient.emailError}
          >
            {recipient.emailError}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
    </tr>
  );
}
