/**
 * Public Signals errors.
 *
 * These map to the existing `{ error, code }` envelope. Messages are safe for
 * the authenticated caller; no SQL, driver detail or recipient data beyond the
 * admin-only detail endpoint is included.
 */

export type SignalsErrorCode =
  | "INVALID_BODY"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_MESSAGE"
  | "MESSAGE_BLANK"
  | "MESSAGE_TOO_LONG"
  | "MESSAGE_CONTROL_CHARACTERS"
  | "INVALID_AUDIENCE"
  | "NO_RECIPIENTS"
  | "TOO_MANY_RECIPIENTS"
  | "INVALID_RECIPIENT_ID"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_PAGINATION"
  | "INVALID_READ_STATE"
  | "RECIPIENT_NOT_ELIGIBLE"
  | "NO_ELIGIBLE_RECIPIENTS"
  | "SIGNAL_NOT_FOUND"
  | "PUBLICATION_RETRY"
  | "SIGNAL_FAILED";

export class SignalsError extends Error {
  readonly status: number;
  readonly code: SignalsErrorCode;

  constructor(status: number, code: SignalsErrorCode, message: string) {
    super(message);
    this.name = "SignalsError";
    this.status = status;
    this.code = code;
  }
}
