/**
 * Live Trade owner resolution.
 *
 * The owner is ALWAYS the authenticated internal DemandScan user resolved by
 * `requireAppUser()` from the Firebase app session. No route, body field or
 * query parameter may supply it, and the Kite user id is never an ownership
 * key.
 *
 * `resolveLiveTradeOwner` is the only producer of `LiveTradeOwnerId`, so a
 * repository call cannot be made with an unverified string.
 */

import { AppAuthError } from "../auth/types";
import { requireActiveSubscription } from "../subscriptions/entitlements";
import { LiveTradeError } from "./errors";
import type { LiveTradeOwnerContext, LiveTradeOwnerId } from "./types";
import { isValidOwnerId } from "./validation";

function mapAuthError(error: unknown): LiveTradeError {
  if (error instanceof AppAuthError) {
    if (error.reason === "SUBSCRIPTION_REQUIRED") {
      return new LiveTradeError("SUBSCRIPTION_REQUIRED");
    }
    if (
      error.reason === "SUSPENDED" ||
      error.reason === "DISABLED" ||
      error.reason === "FORBIDDEN"
    ) {
      return new LiveTradeError("FORBIDDEN");
    }
    return new LiveTradeError("UNAUTHENTICATED");
  }
  return new LiveTradeError("INTERNAL");
}

/**
 * Resolves the owner for a request.
 *
 * Throws `LiveTradeError('UNAUTHENTICATED')` when the app session is missing or
 * unusable, `LiveTradeError('FORBIDDEN')` for a suspended or disabled account,
 * and `LiveTradeError('SUBSCRIPTION_REQUIRED')` when the account has no current
 * subscription. Unexpected failures become INTERNAL rather than a misleading 401.
 */
export async function resolveLiveTradeOwner(
  cookieHeader: string | null | undefined
): Promise<LiveTradeOwnerContext> {
  let userId: string;
  try {
    userId = (await requireActiveSubscription(cookieHeader)).user.userId;
  } catch (error) {
    throw mapAuthError(error);
  }

  if (!isValidOwnerId(userId)) throw new LiveTradeError("INTERNAL");

  return { ownerId: userId as LiveTradeOwnerId };
}

/** Convenience wrapper when only the owner id is needed. */
export async function resolveLiveTradeOwnerId(
  cookieHeader: string | null | undefined
): Promise<LiveTradeOwnerId> {
  return (await resolveLiveTradeOwner(cookieHeader)).ownerId;
}
