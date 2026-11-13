/**
 * Public subscription errors.
 *
 * These map to the existing DemandScan `{ error, code }` envelope. Messages are
 * safe to show to an authenticated administrator; no SQL or internal state is
 * included.
 */

export type SubscriptionErrorCode =
  | "INVALID_INPUT"
  | "PLAN_NOT_FOUND"
  | "PLAN_INACTIVE"
  | "PLAN_NAME_EXISTS"
  | "CUSTOMER_NOT_FOUND"
  | "SUBSCRIPTION_NOT_FOUND"
  | "INVALID_STATE"
  | "SUBSCRIPTION_ENDED"
  | "SUBSCRIPTION_OVERLAP"
  | "RENEWAL_START_REQUIRED"
  | "RENEWAL_OVERLAP"
  | "PLAN_CHANGE_UNSUPPORTED"
  | "PAYMENT_CURRENCY_MISMATCH"
  | "PAYMENT_DATE_FUTURE"
  | "PAYMENT_SUBSCRIPTION_MISMATCH"
  | "WRITE_FAILED";

export class SubscriptionError extends Error {
  readonly status: number;
  readonly code: SubscriptionErrorCode;

  constructor(status: number, code: SubscriptionErrorCode, message: string) {
    super(message);
    this.name = "SubscriptionError";
    this.status = status;
    this.code = code;
  }
}
