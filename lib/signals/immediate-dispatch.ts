/**
 * Bounded email dispatch performed by the publish request itself. SERVER ONLY.
 *
 * Publication and delivery are separate concerns: the signal and its outbox
 * rows are already committed before this runs, and nothing here may undo that
 * or turn it into an error response. Every failure becomes a delivery status.
 *
 * This is not a second queue. It claims from the same `signal_recipients`
 * outbox with the same lease rules as the scheduled dispatcher, restricted to
 * the signal that was just published. Whatever it leaves PENDING — never
 * reached, awaiting retry backoff, or skipped because SMTP is unconfigured —
 * is still due for the scheduled dispatcher.
 */

import { randomUUID } from "node:crypto";
import {
  resolveSignalsEmailConfig,
  type SignalsEmailConfigResult,
} from "./email-config";
import { createSignalsEmailTransport } from "./email-transport";
import { dispatchDueSignals, type DispatchSummary } from "./dispatcher";
import {
  countPendingRecipients,
  releaseClaimedRecipients,
} from "./delivery-repository";
import type { SignalPublishDelivery } from "./types";

/**
 * Same ceiling as the scheduled dispatcher. The time budget, not the batch,
 * bounds the run: a large audience is drained over several scheduled runs.
 */
export const IMMEDIATE_DISPATCH_BATCH_SIZE = 5;

/**
 * Secondary bound on starting new sends. The deadline gate below is stricter
 * whenever SMTP is slow, but this keeps a burst of fast sends bounded as well.
 */
export const IMMEDIATE_DISPATCH_TIME_BUDGET_MS = 20_000;

/**
 * The publish route is allowed 60s on Vercel. Publication is already committed
 * before this runs, so the dispatch phase gets a 45s deadline: with the worst
 * configured SMTP attempt (35s) and a 5s completion reserve, the last attempt
 * that may start still finishes before the deadline, and publication plus the
 * final queries stay inside a 60s invocation. Do not assume Fluid compute is
 * enabled; this budget is sized for the stricter 60s limit.
 */
export const IMMEDIATE_DISPATCH_DEADLINE_MS = 45_000;

/** Swappable seams so the flow can be tested without a database or socket. */
export interface ImmediateDispatchDeps {
  resolveConfig?: () => SignalsEmailConfigResult;
  createTransport?: typeof createSignalsEmailTransport;
  runDispatch?: typeof dispatchDueSignals;
  countPending?: typeof countPendingRecipients;
  releaseClaims?: typeof releaseClaimedRecipients;
}

/**
 * Reads the remaining queue without ever inventing a number. A failed count is
 * reported as `null`; the caller keeps every delivery count it already has.
 */
async function pendingAfter(
  countPending: typeof countPendingRecipients,
  signalId: string
): Promise<number | null> {
  try {
    return await countPending(signalId);
  } catch {
    console.error(
      "[signals] pending recipient count could not be read after publication"
    );
    return null;
  }
}

/**
 * Attempts delivery for one freshly published signal and reports what
 * happened. Never throws: the caller has already published.
 */
export async function dispatchPublishedSignal(
  signalId: string,
  deps: ImmediateDispatchDeps = {}
): Promise<SignalPublishDelivery> {
  const resolveConfig = deps.resolveConfig ?? resolveSignalsEmailConfig;
  const createTransport = deps.createTransport ?? createSignalsEmailTransport;
  const runDispatch = deps.runDispatch ?? dispatchDueSignals;
  const countPending = deps.countPending ?? countPendingRecipients;
  const releaseClaims = deps.releaseClaims ?? releaseClaimedRecipients;

  let config: SignalsEmailConfigResult;
  try {
    config = resolveConfig();
  } catch {
    console.error("[signals] immediate dispatch failed: configuration");
    return {
      attempted: null,
      sent: null,
      failed: null,
      skipped: null,
      pending: await pendingAfter(countPending, signalId),
      status: "DISPATCH_FAILED",
    };
  }

  if (!config.ok) {
    // Incomplete SMTP settings are an operator concern, not a publish failure.
    console.error(
      "[signals] immediate dispatch skipped, email configuration is incomplete:",
      config.problems.join(" ")
    );
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      pending: await pendingAfter(countPending, signalId),
      status: "EMAIL_NOT_CONFIGURED",
    };
  }

  const owner = `publish-${randomUUID()}`;
  let summary: DispatchSummary;
  try {
    summary = await runDispatch({
      config: config.config,
      transport: createTransport(config.config),
      owner,
      batchSize: IMMEDIATE_DISPATCH_BATCH_SIZE,
      timeBudgetMs: IMMEDIATE_DISPATCH_TIME_BUDGET_MS,
      deadlineAt: Date.now() + IMMEDIATE_DISPATCH_DEADLINE_MS,
      signalId,
      // Unattempted claims go straight back to the queue rather than sitting
      // SENDING until the lease expires.
      onUnattempted: async (unattempted) => {
        await releaseClaims(
          unattempted.map((recipient) => recipient.recipientId),
          owner
        );
      },
    });
  } catch (err) {
    console.error(
      "[signals] immediate dispatch failed:",
      err instanceof Error ? err.name : "unknown"
    );
    // The dispatcher never returned, so no delivery count is known. Do not
    // report zeros as if nothing had been sent.
    return {
      attempted: null,
      sent: null,
      failed: null,
      skipped: null,
      pending: await pendingAfter(countPending, signalId),
      status: "DISPATCH_FAILED",
    };
  }

  const counts = {
    attempted: summary.sent + summary.failed + summary.skipped,
    sent: summary.sent,
    failed: summary.failed,
    skipped: summary.skipped,
  };
  const pending = await pendingAfter(countPending, signalId);
  if (pending === null) {
    return {
      ...counts,
      pending: null,
      status: "DISPATCHED_REPORTING_FAILED",
    };
  }
  return { ...counts, pending, status: "DISPATCHED" };
}
