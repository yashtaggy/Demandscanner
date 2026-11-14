/**
 * Signals email dispatcher. SERVER ONLY.
 *
 * Work is discovered from the database, never from the caller. SMTP calls are
 * awaited one at a time, each attempt is bounded by the transport timeouts and
 * the whole run by a time budget. A failure for one recipient never aborts the
 * batch. Nothing here creates, updates or deletes a signal: only the email
 * columns of signal_recipients and the attempt history change.
 *
 * Delivery is at-least-once, not exactly-once. If the process dies after the
 * SMTP server accepts a message but before markRecipientSent() commits, the
 * lease expires and a later dispatch can send the same message again. The
 * deterministic Message-ID makes that traceable; it does not guarantee
 * server-side deduplication. A recorded SENT means the SMTP server accepted
 * the message, not that it reached an inbox or was read.
 */

import { randomUUID } from "node:crypto";
import type { SignalsEmailConfig } from "./email-config";
import {
  buildSignalEmailText,
  buildSignalInboxUrl,
  buildSignalMessageId,
  buildSignalSubject,
} from "./email-content";
import {
  classifySmtpError,
  sendSignalEmail,
  type SignalsEmailTransport,
} from "./email-transport";
import {
  claimDueRecipients,
  DISPATCH_BATCH_SIZE,
  DISPATCH_LEASE_SECONDS,
  findRecipientAccount,
  markRecipientFailed,
  markRecipientSent,
  markRecipientSkipped,
  type ClaimedRecipient,
  type RecipientAccount,
  type SanitizedAttemptError,
} from "./delivery-repository";
import { retryDelaySeconds } from "./dispatch-policy";

/**
 * Stops starting new sends once this much of the invocation is used. The route
 * allows 60s on Vercel; the remaining headroom covers the slowest in-flight
 * SMTP attempt (connection, greeting and socket timeouts).
 */
export const DISPATCH_TIME_BUDGET_MS = 25_000;

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  /** Subset of `failed` that reached the fifth failure and will not retry. */
  terminalFailures: number;
  skipped: number;
  /** Transitions rejected because another dispatcher owns the lease. */
  leaseLost: number;
  /** Claimed rows left SENDING because the time budget was exhausted. */
  deferred: number;
}

export interface DispatchOptions {
  config: SignalsEmailConfig;
  transport: SignalsEmailTransport;
  owner?: string;
  batchSize?: number;
  timeBudgetMs?: number;
}

function inactiveReason(
  account: RecipientAccount | null
): SanitizedAttemptError | null {
  if (!account) {
    return {
      code: "RECIPIENT_NOT_FOUND",
      message: "The recipient account no longer exists.",
    };
  }
  if (account.role !== "CUSTOMER") {
    return {
      code: "RECIPIENT_NOT_CUSTOMER",
      message: "The recipient is no longer a customer account.",
    };
  }
  if (account.status === "ACTIVE") return null;
  if (account.status === "SUSPENDED") {
    return {
      code: "RECIPIENT_SUSPENDED",
      message: "The recipient account is suspended.",
    };
  }
  if (account.status === "DISABLED") {
    return {
      code: "RECIPIENT_DISABLED",
      message: "The recipient account is disabled.",
    };
  }
  return {
    code: "RECIPIENT_INACTIVE",
    message: "The recipient account is not active.",
  };
}

async function deliverOne(
  claimed: ClaimedRecipient,
  options: DispatchOptions,
  owner: string,
  summary: DispatchSummary
): Promise<void> {
  // Re-read the account immediately before the SMTP attempt. A suspension or
  // role change since publication must win over the stale snapshot.
  const account = await findRecipientAccount(claimed.userId);
  const inactive = inactiveReason(account);
  if (inactive) {
    const applied = await markRecipientSkipped(
      claimed.recipientId,
      owner,
      inactive
    );
    if (applied) summary.skipped += 1;
    else summary.leaseLost += 1;
    return;
  }

  const subject = buildSignalSubject(claimed.message);
  const text = buildSignalEmailText({
    message: claimed.message,
    footer: options.config.footer,
    inboxUrl: buildSignalInboxUrl(options.config.appUrl, claimed.signalId),
  });
  const messageId = buildSignalMessageId(
    claimed.signalId,
    claimed.recipientId,
    options.config.fromAddress
  );

  try {
    await sendSignalEmail(options.transport, {
      config: options.config,
      to: claimed.emailAddress,
      subject,
      text,
      messageId,
    });
  } catch (err) {
    const error = classifySmtpError(err);
    const outcome = await markRecipientFailed(
      claimed.recipientId,
      owner,
      error,
      retryDelaySeconds(claimed.priorAttempts + 1)
    );
    if (!outcome.applied) {
      summary.leaseLost += 1;
      return;
    }
    summary.failed += 1;
    if (outcome.terminal) summary.terminalFailures += 1;
    return;
  }

  const applied = await markRecipientSent(claimed.recipientId, owner);
  if (applied) summary.sent += 1;
  else summary.leaseLost += 1;
}

/**
 * Claims one bounded batch and attempts each recipient sequentially. The
 * transport is always closed, even when claiming or a transition fails.
 */
export async function dispatchDueSignals(
  options: DispatchOptions
): Promise<DispatchSummary> {
  const owner = (options.owner ?? `dispatcher-${randomUUID()}`).slice(0, 200);
  const batchSize = Math.min(
    10,
    Math.max(1, Math.floor(options.batchSize ?? DISPATCH_BATCH_SIZE))
  );
  const timeBudgetMs = Math.max(1_000, options.timeBudgetMs ?? DISPATCH_TIME_BUDGET_MS);
  const startedAt = Date.now();
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    failed: 0,
    terminalFailures: 0,
    skipped: 0,
    leaseLost: 0,
    deferred: 0,
  };

  try {
    const claims = await claimDueRecipients(owner, batchSize, DISPATCH_LEASE_SECONDS);
    summary.claimed = claims.length;

    for (let index = 0; index < claims.length; index += 1) {
      if (Date.now() - startedAt >= timeBudgetMs) {
        summary.deferred = claims.length - index;
        break;
      }
      await deliverOne(claims[index], options, owner, summary);
    }

    return summary;
  } finally {
    try {
      options.transport.close?.();
    } catch {
      // Closing a socket must never mask the delivery outcome.
    }
  }
}
