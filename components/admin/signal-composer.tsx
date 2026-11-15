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
    const attempt = resolveIdempotencyAttempt(
      attemptRef.current,
      fingerprint,
      newIdempotencyKey
    );
    // Keep the key for a retry of this exact request; any edit changes the
    // fingerprint and therefore starts a new attempt with a new key.
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
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Compose signal</h2>
        <p className="text-xs text-slate-500">
          Plain text. Line breaks, whitespace and emoji are preserved exactly as
          written. Recipients see the message in their Signals inbox.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="signal-message" className="sr-only">
          Signal message
        </label>
        <textarea
          id="signal-message"
          className={`${inputClass} min-h-40 resize-y`}
          placeholder="Write the signal message…"
          value={message}
          disabled={busy}
          onChange={(event) => {
            setMessage(event.target.value);
            setConfirming(false);
            setSuccess(null);
            setError(null);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={`text-[11px] tabular-nums ${
              characters > SIGNAL_MESSAGE_MAX_LENGTH
                ? "text-rose-400"
                : "text-slate-500"
            }`}
          >
            {characters.toLocaleString("en-IN")} /{" "}
            {SIGNAL_MESSAGE_MAX_LENGTH.toLocaleString("en-IN")} characters
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={resetComposer}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-slate-600">
          Preview
        </p>
        <div className="min-h-20 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 whitespace-pre-wrap break-words">
          {message.trim().length > 0 ? (
            message
          ) : (
            <span className="text-slate-600">Nothing to preview yet.</span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-300">Recipients</p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={mode === "SELECTED" ? "primary" : "ghost"}
              disabled={busy}
              onClick={() => changeMode("SELECTED")}
            >
              Selected
            </Button>
            <Button
              size="sm"
              variant={mode === "ALL_ELIGIBLE" ? "primary" : "ghost"}
              disabled={busy}
              onClick={() => changeMode("ALL_ELIGIBLE")}
            >
              All eligible
            </Button>
          </div>
        </div>

        {mode === "ALL_ELIGIBLE" ? (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 text-xs text-indigo-200/90">
            Sends to every active customer account at the moment of publishing,
            regardless of subscription state. The server resolves the audience;
            no customer list is loaded in the browser. Publication fails if the
            resolved audience exceeds 1,000 recipients.
          </div>
        ) : (
          <div className="space-y-3">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                beginRecipientLoad(search.trim(), RECIPIENT_PAGE_SIZE, false);
              }}
            >
              <input
                className={`${inputClass} w-full sm:w-72`}
                placeholder="Search by email or name"
                value={search}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                type="submit"
                loading={recipientLoading}
                disabled={busy}
              >
                Search
              </Button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant={selection.size > 0 ? "info" : "neutral"}>
                  {selected.length} selected
                </Badge>
                {selected.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setSelection(new Map())}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || recipients.length === 0}
                onClick={() =>
                  setSelection((current) =>
                    visibleAllSelected
                      ? clearRecipients(current, recipients)
                      : selectRecipients(current, recipients)
                  )
                }
              >
                {visibleAllSelected
                  ? "Deselect visible"
                  : `Select all visible (${recipients.length})`}
              </Button>
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.slice(0, CHIP_LIMIT).map((recipient) => (
                  <span
                    key={recipient.userId}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-600/60 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300"
                  >
                    {recipient.displayName || recipient.email}
                    <button
                      type="button"
                      className="text-slate-500 hover:text-rose-300"
                      aria-label={`Remove ${recipient.email}`}
                      disabled={busy}
                      onClick={() =>
                        setSelection((current) =>
                          toggleRecipient(current, recipient, false)
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                {selected.length > CHIP_LIMIT && (
                  <span className="px-1 text-[11px] text-slate-500">
                    +{selected.length - CHIP_LIMIT} more
                  </span>
                )}
              </div>
            )}

            {recipientError && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-rose-400">{recipientError}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    beginRecipientLoad(query, limit, recipients.length > 0)
                  }
                >
                  Try again
                </Button>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-700/40">
              {recipientLoading && recipients.length === 0 ? (
                <div
                  className="space-y-2 p-3"
                  aria-label="Loading eligible recipients"
                >
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-9 animate-pulse rounded-lg bg-slate-800/50"
                    />
                  ))}
                </div>
              ) : recipients.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">
                  No active customer accounts match this search.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800/70">
                  {recipients.map((recipient) => {
                    const key = selectionKey(recipient.userId);
                    const checked = selection.has(key);
                    return (
                      <li key={recipient.userId}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-800/40">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-indigo-500"
                            checked={checked}
                            disabled={busy}
                            onChange={(event) =>
                              setSelection((current) =>
                                toggleRecipient(
                                  current,
                                  recipient,
                                  event.target.checked
                                )
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-200">
                              {recipient.displayName || recipient.email}
                            </span>
                            <span className="block truncate text-[11px] text-slate-500">
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">
                Selections persist across searches.
              </span>
              {hasMore && limit < RECIPIENT_PAGE_LIMIT && (
                <Button
                  size="sm"
                  variant="secondary"
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
                <span className="text-[11px] text-amber-300/80">
                  Showing the first {RECIPIENT_PAGE_LIMIT} matches. Refine the
                  search to find others.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {success && (
        <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium text-emerald-300">
            {success.signal.reused
              ? `Already published to ${recipientSummaryLabel(
                  success.signal.recipientCount
                )}.`
              : success.delivery
                ? publishDeliveryLabel(success.delivery)
                : `Signal published to ${recipientSummaryLabel(
                    success.signal.recipientCount
                  )}.`}
          </p>
          <p className="text-xs text-slate-400">
            Recipients can open it now in their Signals inbox.
          </p>
          <Link
            className="text-xs text-indigo-300 hover:text-indigo-200"
            href={`/admin/signals/${success.signal.signalId}`}
          >
            Open signal details →
          </Link>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {!confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={busy || validation !== null}
            onClick={beginPublish}
          >
            Publish signal
          </Button>
          {validation && (
            <span className="text-[11px] text-slate-500">{validation}</span>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-200">
            Publish to{" "}
            {mode === "ALL_ELIGIBLE"
              ? "every eligible customer"
              : recipientSummaryLabel(selected.length)}
            ?
          </p>
          <p className="text-[11px] text-slate-500">
            A published signal cannot be edited. Recipients see it immediately
            in their Signals inbox, and email delivery is attempted as soon as
            you confirm.
          </p>
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => void confirmPublish()}>
              Confirm publish
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
