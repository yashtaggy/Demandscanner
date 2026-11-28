"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminRequest, inputClass } from "@/components/admin/admin-client";
import { SIGNAL_MESSAGE_MAX_LENGTH } from "@/lib/signals/validation";
import type {
  EligibleRecipient,
  SignalAudienceMode,
  SignalPublication,
  SignalPublishDelivery,
} from "@/lib/signals/types";
import {
  RECIPIENT_PAGE_LIMIT,
  RECIPIENT_PAGE_SIZE,
  allVisibleSelected,
  audienceFor,
  clearRecipients,
  countCodePoints,
  mergeRecipients,
  newIdempotencyKey,
  publishDeliveryLabel,
  publishValidation,
  recipientSummaryLabel,
  requestFingerprint,
  resolveIdempotencyAttempt,
  selectRecipients,
  selectedRecipients,
  selectionKey,
  toggleRecipient,
  type IdempotencyAttempt,
  type Selection,
} from "@/lib/signals/ui";

const CHIP_LIMIT = 30;

interface RecipientResponse {
  recipients: EligibleRecipient[];
  hasMore: boolean;
}

function messageFor(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function SignalComposer({ onPublished }: { onPublished: () => void }) {
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<SignalAudienceMode>("SELECTED");
  const [selection, setSelection] = useState<Selection>(new Map());

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(RECIPIENT_PAGE_SIZE);
  const [recipients, setRecipients] = useState<EligibleRecipient[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [recipientLoading, setRecipientLoading] = useState(true);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    signal: SignalPublication;
    delivery: SignalPublishDelivery | null;
  } | null>(null);

  const attemptRef = useRef<IdempotencyAttempt | null>(null);
  const submittingRef = useRef(false);
  const requestSeq = useRef(0);

  const loadRecipients = useCallback(
    async (term: string, nextLimit: number, append: boolean) => {
      const seq = ++requestSeq.current;
      try {
        const data = await adminRequest<RecipientResponse>(
          `/api/admin/signals/eligible-recipients?search=${encodeURIComponent(
            term
          )}&limit=${nextLimit}`,
          "GET"
        );
        if (seq !== requestSeq.current) return;
        setRecipients((current) =>
          append ? mergeRecipients(current, data.recipients) : data.recipients
        );
        setHasMore(data.hasMore);
        setQuery(term);
        setLimit(nextLimit);
        setRecipientError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setRecipientError(messageFor(err, "Could not load eligible recipients"));
      } finally {
        if (seq === requestSeq.current) setRecipientLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    const seq = ++requestSeq.current;
    adminRequest<RecipientResponse>(
      `/api/admin/signals/eligible-recipients?search=&limit=${RECIPIENT_PAGE_SIZE}`,
      "GET"
    ).then(
      (data) => {
        if (!active || seq !== requestSeq.current) return;
        setRecipients(data.recipients);
        setHasMore(data.hasMore);
        setQuery("");
        setLimit(RECIPIENT_PAGE_SIZE);
        setRecipientError(null);
        setRecipientLoading(false);
      },
      (err: unknown) => {
        if (!active || seq !== requestSeq.current) return;
        setRecipientError(messageFor(err, "Could not load eligible recipients"));
        setRecipientLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  function beginRecipientLoad(term: string, nextLimit: number, append: boolean) {
    setRecipientLoading(true);
    setRecipientError(null);
    if (!append) setRecipients([]);
    void loadRecipients(term, nextLimit, append);
  }

  const validation = publishValidation(message, mode, selection.size);
  const selected = selectedRecipients(selection);
  const visibleAllSelected = allVisibleSelected(selection, recipients);
  const characters = countCodePoints(message);

  function resetComposer() {
    setMessage("");
    setSelection(new Map());
    setMode("SELECTED");
    setConfirming(false);
    setError(null);
    setSuccess(null);
    attemptRef.current = null;
  }

  function changeMode(next: SignalAudienceMode) {
    setMode(next);
    setConfirming(false);
    setError(null);
  }

  function beginPublish() {
    if (busy) return;
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setSuccess(null);
    setConfirming(true);
  }

  async function confirmPublish() {
    if (busy || submittingRef.current) return;
    const audience = audienceFor(mode, selection);
    const fingerprint = requestFingerprint(
      message,
      mode,
      audience.mode === "SELECTED" ? audience.userIds : []
    );
    // An exact retry keeps its key; any edit starts a new idempotency attempt.
    const attempt = resolveIdempotencyAttempt(
      attemptRef.current,
      fingerprint,
      newIdempotencyKey
    );
    attemptRef.current = attempt;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const data = await adminRequest<{
        signal: SignalPublication;
        delivery: SignalPublishDelivery | null;
      }>("/api/admin/signals", "POST", {
        message,
        audience,
        idempotencyKey: attempt.key,
      });
      setConfirming(false);
      setSuccess({ signal: data.signal, delivery: data.delivery ?? null });
      attemptRef.current = null;
      setMessage("");
      setSelection(new Map());
      setMode("SELECTED");
      onPublished();
    } catch (err) {
      setError(messageFor(err, "Could not publish the signal"));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="ds-panel space-y-6 p-5 sm:p-7" aria-labelledby="compose-title">
      <div className="border-b border-[var(--ds-border)] pb-5">
        <p className="ds-label">Publish</p>
        <h2 id="compose-title" className="mt-2 text-lg font-semibold text-[var(--ds-text)]">
          Compose signal
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ds-text-secondary)]">
          Plain text. Line breaks, whitespace and emoji are preserved exactly as written. Recipients see the message in their Signals inbox.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="signal-message" className="ds-label">
            Signal message
          </label>
          <span
            id="signal-message-count"
            className={`ds-mono text-[11px] ${
              characters > SIGNAL_MESSAGE_MAX_LENGTH
                ? "text-[var(--ds-negative)]"
                : "text-[var(--ds-text-secondary)]"
            }`}
          >
            {characters.toLocaleString("en-IN")} / {SIGNAL_MESSAGE_MAX_LENGTH.toLocaleString("en-IN")} characters
          </span>
        </div>
        <textarea
          id="signal-message"
          className={`${inputClass} min-h-40`}
          placeholder="Write the signal message…"
          aria-describedby="signal-message-help signal-message-count"
          value={message}
          disabled={busy}
          onChange={(event) => {
            setMessage(event.target.value);
            setConfirming(false);
            setSuccess(null);
            setError(null);
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <p id="signal-message-help" className="text-xs text-[var(--ds-text-secondary)]">
            Published signals cannot be edited.
          </p>
          <Button size="sm" variant="ghost" light disabled={busy} onClick={resetComposer}>
            Clear
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="ds-label">Preview</p>
        <div className="ds-panel-subtle min-h-24 whitespace-pre-wrap break-words p-4 text-sm leading-6 text-[var(--ds-text)]">
          {message.trim().length > 0 ? (
            message
          ) : (
            <span className="text-[var(--ds-text-secondary)]">Nothing to preview yet.</span>
          )}
        </div>
      </div>

      <div className="space-y-4 border-t border-[var(--ds-border)] pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-[var(--ds-text)]">Recipients</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={mode === "SELECTED" ? "primary" : "ghost"}
              light
              aria-pressed={mode === "SELECTED"}
              disabled={busy}
              onClick={() => changeMode("SELECTED")}
            >
              Selected
            </Button>
            <Button
              size="sm"
              variant={mode === "ALL_ELIGIBLE" ? "primary" : "ghost"}
              light
              aria-pressed={mode === "ALL_ELIGIBLE"}
              disabled={busy}
              onClick={() => changeMode("ALL_ELIGIBLE")}
            >
              All eligible
            </Button>
          </div>
        </div>

        {mode === "ALL_ELIGIBLE" ? (
          <div className="ds-alert ds-alert-info">
            Sends to every active customer account at the moment of publishing, regardless of subscription state. The server resolves the audience; no customer list is loaded in the browser. Publication fails if the resolved audience exceeds 1,000 recipients.
          </div>
        ) : (
          <div className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                beginRecipientLoad(search.trim(), RECIPIENT_PAGE_SIZE, false);
              }}
            >
              <label htmlFor="recipient-search" className="sr-only">
                Search eligible recipients
              </label>
              <input
                id="recipient-search"
                className={`${inputClass} sm:max-w-sm sm:flex-1`}
                placeholder="Search by email or name"
                value={search}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button size="md" variant="secondary" light type="submit" loading={recipientLoading} disabled={busy}>
                Search
              </Button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selection.size > 0 ? "info" : "neutral"} light>
                  {selected.length} selected
                </Badge>
                {selected.length > 0 && (
                  <Button size="sm" variant="ghost" light disabled={busy} onClick={() => setSelection(new Map())}>
                    Clear selection
                  </Button>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                light
                disabled={busy || recipients.length === 0}
                onClick={() =>
                  setSelection((current) =>
                    visibleAllSelected
                      ? clearRecipients(current, recipients)
                      : selectRecipients(current, recipients)
                  )
                }
              >
                {visibleAllSelected ? "Deselect visible" : `Select all visible (${recipients.length})`}
              </Button>
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Selected recipients">
                {selected.slice(0, CHIP_LIMIT).map((recipient) => (
                  <span
                    key={recipient.userId}
                    className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] py-1 pl-3 pr-1 text-[11px] text-[var(--ds-text-secondary)]"
                  >
                    <span className="truncate">{recipient.displayName || recipient.email}</span>
                    <button
                      type="button"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base text-[var(--ds-text-secondary)] hover:bg-[var(--ds-negative-soft)] hover:text-[var(--ds-negative)]"
                      aria-label={`Remove ${recipient.email}`}
                      disabled={busy}
                      onClick={() =>
                        setSelection((current) => toggleRecipient(current, recipient, false))
                      }
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                ))}
                {selected.length > CHIP_LIMIT && (
                  <span className="self-center px-1 text-[11px] text-[var(--ds-text-secondary)]">
                    +{selected.length - CHIP_LIMIT} more
                  </span>
                )}
              </div>
            )}

            {recipientError && (
              <div className="ds-alert ds-alert-negative" role="alert">
                <p>{recipientError}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  light
                  className="mt-3"
                  onClick={() => beginRecipientLoad(query, limit, recipients.length > 0)}
                >
                  Try again
                </Button>
              </div>
            )}

            <div className="max-h-80 overflow-y-auto rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-elevated)]">
              {recipientLoading && recipients.length === 0 ? (
                <div className="space-y-2 p-3" aria-label="Loading eligible recipients">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="ds-skeleton h-12" />
                  ))}
                </div>
              ) : recipients.length === 0 ? (
                <p className="p-4 text-sm text-[var(--ds-text-secondary)]">
                  No active customer accounts match this search.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--ds-border)]">
                  {recipients.map((recipient) => {
                    const key = selectionKey(recipient.userId);
                    const checked = selection.has(key);
                    return (
                      <li key={recipient.userId}>
                        <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 hover:bg-[var(--ds-gold-50)]">
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0 accent-[var(--ds-gold-500)]"
                            checked={checked}
                            disabled={busy}
                            onChange={(event) =>
                              setSelection((current) =>
                                toggleRecipient(current, recipient, event.target.checked)
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--ds-text)]">
                              {recipient.displayName || recipient.email}
                            </span>
                            <span className="block truncate text-[11px] text-[var(--ds-text-secondary)]">
                              {recipient.email}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-[var(--ds-text-secondary)]">Selections persist across searches.</span>
              {hasMore && limit < RECIPIENT_PAGE_LIMIT && (
                <Button
                  size="sm"
                  variant="secondary"
                  light
                  loading={recipientLoading}
                  disabled={busy}
                  onClick={() =>
                    beginRecipientLoad(
                      query,
                      Math.min(limit + RECIPIENT_PAGE_SIZE, RECIPIENT_PAGE_LIMIT),
                      true
                    )
                  }
                >
                  Load more
                </Button>
              )}
              {hasMore && limit >= RECIPIENT_PAGE_LIMIT && (
                <span className="text-xs text-[var(--ds-warning)]">
                  Showing the first {RECIPIENT_PAGE_LIMIT} matches. Refine the search to find others.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {success && (
        <div className="ds-alert ds-alert-positive" role="status">
          <p className="font-semibold">
            {success.signal.reused
              ? `Already published to ${recipientSummaryLabel(success.signal.recipientCount)}.`
              : success.delivery
                ? publishDeliveryLabel(success.delivery)
                : `Signal published to ${recipientSummaryLabel(success.signal.recipientCount)}.`}
          </p>
          <p className="mt-1.5">Recipients can open it now in their Signals inbox.</p>
          <Link
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ds-positive)] underline underline-offset-4"
            href={`/admin/signals/${success.signal.signalId}`}
          >
            Open signal details →
          </Link>
        </div>
      )}

      {error && (
        <p className="ds-alert ds-alert-negative" role="alert">
          {error}
        </p>
      )}

      {!confirming ? (
        <div className="flex flex-col gap-3 border-t border-[var(--ds-border)] pt-6 sm:flex-row sm:items-center">
          <Button size="md" light className="w-full sm:w-auto" disabled={busy || validation !== null} onClick={beginPublish}>
            Publish signal
          </Button>
          {validation && <span className="text-xs text-[var(--ds-text-secondary)]">{validation}</span>}
        </div>
      ) : (
        <div className="ds-alert ds-alert-warning" aria-live="polite">
          <p className="font-semibold">
            Publish to {mode === "ALL_ELIGIBLE" ? "every eligible customer" : recipientSummaryLabel(selected.length)}?
          </p>
          <p className="mt-1.5">
            A published signal cannot be edited. Recipients see it immediately in their Signals inbox, and email delivery is attempted as soon as you confirm.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="md" light loading={busy} onClick={() => void confirmPublish()}>
              Confirm publish
            </Button>
            <Button size="md" variant="ghost" light disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
