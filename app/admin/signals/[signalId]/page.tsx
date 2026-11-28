"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OverviewShell } from "@/components/overview/app-shell";
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
    <OverviewShell lastRefreshed={null}>
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--ds-text-secondary)] hover:text-[var(--ds-text)]"
            href="/admin/signals"
          >
            <span aria-hidden="true">←</span> Back to signals
          </Link>
          <p className="ds-label">Super administrator</p>
        </div>

        <header className="border-b border-[var(--ds-border)] pb-6">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)] sm:text-3xl">
            Signal details
          </h1>
          <p className="mt-2 text-sm text-[var(--ds-text-secondary)]">
            Publication content, recipient delivery and read state.
          </p>
        </header>

        {loading ? (
          <div className="space-y-4" aria-label="Loading signal details">
            <div className="ds-skeleton h-64" />
            <div className="ds-skeleton h-40" />
          </div>
        ) : !user ? (
          <div className="ds-empty">
            <h2 className="text-base font-semibold text-[var(--ds-text)]">
              Sign in with a super administrator account
            </h2>
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
              Signal details are limited to super administrators.
            </p>
          </div>
        ) : (
          <SignalDetailView signalId={signalId} />
        )}
      </main>
    </OverviewShell>
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
      <div className="space-y-4" aria-label="Loading signal details">
        <div className="ds-skeleton h-64" />
        <div className="ds-skeleton h-40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ds-alert ds-alert-negative" role="alert">
        <p className="font-semibold">{error}</p>
        <Button variant="secondary" size="sm" light className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="space-y-6">
      <section className="ds-panel p-5 sm:p-7" aria-labelledby="publication-title">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="publication-title" className="text-lg font-semibold text-[var(--ds-text)]">
              Published message
            </h2>
            <p className="ds-mono mt-3 text-xs text-[var(--ds-text-secondary)]">
              {formatDateTime(detail.publishedAt)}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-[var(--ds-text-secondary)]">
              Created {formatDateTime(detail.createdAt)}
              {detail.createdBy
                ? ` by ${detail.createdBy.displayName || detail.createdBy.email}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={signalStatusVariant(detail.status)} light>
              {detail.status}
            </Badge>
            <Badge variant="neutral" light>
              {recipientSummaryLabel(detail.recipientCount)}
            </Badge>
          </div>
        </div>

        <div className="mt-6 rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-5 py-6 text-sm leading-7 text-[var(--ds-text)] whitespace-pre-wrap break-words sm:px-7 sm:py-8">
          {detail.message}
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          <SummaryStat label="Pending" value={detail.delivery.pending} />
          <SummaryStat label="Sending" value={detail.delivery.sending} tone="info" />
          <SummaryStat label="Sent" value={detail.delivery.sent} tone="success" />
          <SummaryStat label="Failed" value={detail.delivery.failed} tone={detail.delivery.failed > 0 ? "danger" : "neutral"} />
          <SummaryStat label="Skipped" value={detail.delivery.skipped} tone={detail.delivery.skipped > 0 ? "warning" : "neutral"} />
          <SummaryStat label="Read" value={detail.read.read} />
          <SummaryStat label="Unread" value={detail.read.unread} />
        </dl>

        {detail.delivery.failed > 0 && (
          <div className="ds-alert ds-alert-warning mt-6" aria-live="polite">
            <p className="font-semibold">
              {detail.delivery.failed} recipient{detail.delivery.failed === 1 ? "" : "s"} failed delivery
            </p>
            <p className="mt-1.5">
              Retrying resets still-active failed recipients to pending so a future dispatcher can attempt them again. It does not send email now.
            </p>

            {retryResult && (
              <p className="ds-alert ds-alert-positive mt-3">
                {retryResult.retriedCount} recipient{retryResult.retriedCount === 1 ? "" : "s"} requeued.
                {retryResult.retriedCount === 0
                  ? " They may no longer be active customers."
                  : " No email has been sent."}
              </p>
            )}
            {retryError && (
              <p className="ds-alert ds-alert-negative mt-3" role="alert">
                {retryError}
              </p>
            )}

            {confirmRetry ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" light loading={retrying} onClick={() => void retryFailed()}>
                  Confirm retry
                </Button>
                <Button size="sm" variant="ghost" light disabled={retrying} onClick={() => setConfirmRetry(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                light
                className="mt-4"
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

      <section className="ds-panel overflow-hidden" aria-labelledby="recipients-title">
        <div className="flex flex-col gap-2 border-b border-[var(--ds-border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <h2 id="recipients-title" className="text-base font-semibold text-[var(--ds-text)]">
            Recipients
          </h2>
          <span className="text-xs text-[var(--ds-text-secondary)]">
            Emails are the address recorded at publication time.
          </span>
        </div>

        {detail.recipients.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--ds-text-secondary)] sm:px-7">
            This signal has no recipient records.
          </div>
        ) : (
          <div className="ds-table-wrap border-0 rounded-none" tabIndex={0} role="region" aria-label="Signal recipients table">
            <table className="ds-table min-w-[1080px]">
              <thead>
                <tr>
                  <th scope="col">Recipient</th>
                  <th scope="col">Read</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Last attempt</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {detail.recipients.map((recipient) => (
                  <RecipientRow key={recipient.recipientId} recipient={recipient} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "success" | "danger" | "warning" | "neutral" | "info";
}) {
  return (
    <div className="rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)] px-3 py-3">
      <dt className="text-[11px] font-medium text-[var(--ds-text-secondary)]">{label}</dt>
      <dd className="ds-mono mt-1.5 text-lg font-semibold text-[var(--ds-text)]">{value}</dd>
      <span
        aria-hidden="true"
        className={`mt-2 block h-1 w-8 rounded-full ${
          tone === "success"
            ? "bg-[var(--ds-positive)]"
            : tone === "danger"
              ? "bg-[var(--ds-negative)]"
              : tone === "warning"
                ? "bg-[var(--ds-warning)]"
                : tone === "info"
                  ? "bg-[var(--ds-info)]"
                  : "bg-[var(--ds-border-strong)]"
        }`}
      />
    </div>
  );
}

function RecipientRow({ recipient }: { recipient: SignalRecipientDetail }) {
  return (
    <tr>
      <td>
        <p className="font-medium text-[var(--ds-text)]">{recipient.displayName || recipient.email}</p>
        <p className="mt-1 text-[11px] text-[var(--ds-text-secondary)]">{recipient.email}</p>
      </td>
      <td>
        {recipient.readAt ? (
          <span className="ds-mono whitespace-nowrap text-[var(--ds-positive)]">
            {formatDateTime(recipient.readAt)}
          </span>
        ) : (
          <span className="text-[var(--ds-text-secondary)]">Unread</span>
        )}
      </td>
      <td>
        <Badge variant={emailStatusVariant(recipient.emailStatus)} light>
          {recipient.emailStatus}
        </Badge>
      </td>
      <td className="ds-mono">{recipient.emailAttempts}</td>
      <td className="ds-mono whitespace-nowrap text-[var(--ds-text-secondary)]">
        {recipient.emailLastAttemptAt ? formatDateTime(recipient.emailLastAttemptAt) : "—"}
      </td>
      <td className="ds-mono whitespace-nowrap text-[var(--ds-text-secondary)]">
        {recipient.emailSentAt ? formatDateTime(recipient.emailSentAt) : "—"}
      </td>
      <td className="max-w-[20rem] break-words text-[var(--ds-text-secondary)]">
        {recipient.emailError || "—"}
      </td>
    </tr>
  );
}
