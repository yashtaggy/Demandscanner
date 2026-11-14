/**
 * Deterministic Signals delivery policy. Pure and testable.
 */

export const SIGNAL_EMAIL_MAX_ATTEMPTS = 5;
export const SIGNAL_EMAIL_BASE_BACKOFF_SECONDS = 60;
export const SIGNAL_EMAIL_MAX_BACKOFF_SECONDS = 3_600;

/**
 * 60s, 120s, 240s, 480s for the first four failures. The fifth failure is
 * terminal and never reaches this function for scheduling.
 */
export function retryDelaySeconds(failedAttempts: number): number {
  const attempt = Math.max(1, Math.floor(failedAttempts));
  const delay = SIGNAL_EMAIL_BASE_BACKOFF_SECONDS * 2 ** (attempt - 1);
  return Math.min(SIGNAL_EMAIL_MAX_BACKOFF_SECONDS, delay);
}
