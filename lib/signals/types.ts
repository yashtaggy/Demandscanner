/**
 * Signals administration DTOs. SERVER ONLY.
 *
 * Recipient identity is always app_users.user_id; the email address is the
 * publication-time snapshot stored in signal_recipients.
 */

export type SignalAudienceMode = "SELECTED" | "ALL_ELIGIBLE";

export type SignalEmailStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export type SignalStatus = "PUBLISHED" | "ARCHIVED";

export interface EligibleRecipient {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface EligibleRecipientPage {
  recipients: EligibleRecipient[];
  hasMore: boolean;
}

export interface SignalPublication {
  signalId: string;
  message: string;
  publishedAt: string;
  createdBy: string | null;
  status: SignalStatus;
  recipientCount: number;
  /** True when an idempotency key returned an already-published signal. */
  reused: boolean;
}

export interface SignalDeliverySummary {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Outcome of the bounded email attempt made during publication.
 *
 * `attempted` is the number of recipients this request actually tried; `sent`
 * counts records that reached SENT and is never reset when a later reporting
 * step fails. `pending` is the number still queued afterwards, or `null` when
 * the queue count could not be read — it is never guessed.
 *
 * DISPATCHED_REPORTING_FAILED means delivery itself finished and the counts are
 * reliable, but the remaining queue is unknown. DISPATCH_FAILED means the
 * dispatcher did not return, so no delivery count is known either.
 */
export interface SignalPublishDeliveryCounts {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

export type SignalPublishDeliveryStatus =
  | "DISPATCHED"
  | "DISPATCHED_REPORTING_FAILED"
  | "EMAIL_NOT_CONFIGURED"
  | "DISPATCH_FAILED";

export type SignalPublishDelivery =
  | (SignalPublishDeliveryCounts & {
      status: "DISPATCHED";
      pending: number;
    })
  | (SignalPublishDeliveryCounts & {
      status: "DISPATCHED_REPORTING_FAILED";
      pending: null;
    })
  | (SignalPublishDeliveryCounts & {
      status: "EMAIL_NOT_CONFIGURED";
      pending: number | null;
    })
  | {
      status: "DISPATCH_FAILED";
      attempted: null;
      sent: null;
      failed: null;
      skipped: null;
      pending: number | null;
    };

export interface SignalReadSummary {
  read: number;
  unread: number;
}

export interface SignalHistoryEntry {
  signalId: string;
  messagePreview: string;
  publishedAt: string;
  status: SignalStatus;
  recipientCount: number;
  delivery: SignalDeliverySummary;
  read: SignalReadSummary;
}

export interface SignalHistoryPage {
  signals: SignalHistoryEntry[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SignalCreator {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface SignalRecipientDetail {
  recipientId: string;
  userId: string;
  email: string;
  displayName: string | null;
  readAt: string | null;
  emailStatus: SignalEmailStatus;
  emailAttempts: number;
  emailLastAttemptAt: string | null;
  emailSentAt: string | null;
  emailError: string | null;
}

export interface SignalDetail {
  signalId: string;
  message: string;
  publishedAt: string;
  createdAt: string;
  status: SignalStatus;
  createdBy: SignalCreator | null;
  recipientCount: number;
  delivery: SignalDeliverySummary;
  read: SignalReadSummary;
  recipients: SignalRecipientDetail[];
}

export interface RetryFailedResult {
  signalId: string;
  retriedCount: number;
}

/**
 * Customer-facing shapes. These never include email delivery state, recipient
 * rows belonging to other customers, or administrative metadata.
 */
export interface CustomerSignalSummary {
  signalId: string;
  messagePreview: string;
  publishedAt: string;
  readAt: string | null;
  isRead: boolean;
}

export interface CustomerSignalInbox {
  signals: CustomerSignalSummary[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}

export interface CustomerSignalDetail {
  signalId: string;
  message: string;
  publishedAt: string;
  readAt: string | null;
  isRead: boolean;
}

export interface CustomerReadState {
  signalId: string;
  readAt: string | null;
  isRead: boolean;
}
