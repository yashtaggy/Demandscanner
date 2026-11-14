/**
 * Signal email content. SERVER ONLY and pure.
 *
 * The message is plain text and is never converted to HTML, re-wrapped or
 * trimmed: the stored message is the first byte-for-byte part of the body.
 * Only the subject is derived from it, because a mail subject cannot contain
 * line breaks.
 */

export const SIGNALS_EMAIL_SUBJECT_FALLBACK = "New Trading Signal";
export const SIGNALS_EMAIL_SUBJECT_MAX_LENGTH = 120;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * The first line that contains visible text becomes the subject. Control
 * characters are removed, whitespace is collapsed and the result is bounded.
 */
export function buildSignalSubject(message: string): string {
  const firstLine = message
    .split(/\r\n|\n|\r/)
    .find((line) => line.trim().length > 0);

  if (!firstLine) return SIGNALS_EMAIL_SUBJECT_FALLBACK;

  const cleaned = firstLine
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return SIGNALS_EMAIL_SUBJECT_FALLBACK;

  const points = [...cleaned];
  if (points.length <= SIGNALS_EMAIL_SUBJECT_MAX_LENGTH) return cleaned;
  return `${points.slice(0, SIGNALS_EMAIL_SUBJECT_MAX_LENGTH - 3).join("").trimEnd()}...`;
}

/** Resolves the customer inbox link against the configured Signals app URL. */
export function buildSignalInboxUrl(appUrl: string, signalId: string): string {
  const base = appUrl.endsWith("/") ? appUrl : `${appUrl}/`;
  return new URL(`signals/${signalId}`, base).toString();
}

export interface SignalEmailTextInput {
  message: string;
  footer: string | null;
  inboxUrl: string;
}

/**
 * Plain-text body: the original message untouched, then the optional operator
 * footer, then the inbox link.
 */
export function buildSignalEmailText(input: SignalEmailTextInput): string {
  const parts = [input.message];
  if (input.footer) parts.push(input.footer);
  parts.push(`View this signal in DemandScan:\n${input.inboxUrl}`);
  return parts.join("\n\n");
}

/**
 * Deterministic Message-ID derived from the signal and recipient rows. It
 * makes duplicates traceable; it does not make SMTP delivery exactly-once.
 */
export function buildSignalMessageId(
  signalId: string,
  recipientId: string,
  fromAddress: string
): string {
  const configuredDomain = fromAddress.split("@")[1] ?? "";
  const domain = /^[A-Za-z0-9.-]+$/.test(configuredDomain)
    ? configuredDomain.toLowerCase()
    : "demandscan.local";
  return `<signal.${signalId}.recipient.${recipientId}@${domain}>`;
}
