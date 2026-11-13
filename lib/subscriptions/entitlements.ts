/**
 * Central subscription entitlement gate. SERVER ONLY.
 *
 * Every customer-facing API that exposes scanner, stock, market-data or Live
 * Trade data resolves its caller through this module instead of calling
 * `requireAppUser()` directly. It composes the existing identity check with the
 * database predicate `is_subscription_entitled()`, so access cannot drift from
 * what an admin sees in the console.
 *
 * Exempt: `/api/admin/*` (role-based administration must work for an admin
 * without a subscription), `/api/auth/*`, `/api/health`, Kite connect/callback
 * and the operator market-data routes.
 */

import { requireAppUser } from "../auth/session";
import { AppAuthError, type AppUser } from "../auth/types";
import { getSubscriptionState } from "./repository";
import type { SubscriptionState } from "./types";

export interface EntitledSession {
  user: AppUser;
  subscription: SubscriptionState;
}

/**
 * Requires a valid app session AND a subscription that is ACTIVE at the current
 * Asia/Kolkata date. Throws:
 *  - `UNAUTHENTICATED` / `INVALID_SESSION` / `NO_IDENTITY` when the session is
 *    unusable,
 *  - `SUSPENDED` / `DISABLED` when the account is blocked,
 *  - `SUBSCRIPTION_REQUIRED` when the account is healthy but has no current,
 *    activated subscription.
 *
 * Database failures propagate; callers map them to their own 5xx response so a
 * transient outage never becomes "access granted".
 */
export async function requireActiveSubscription(
  cookieHeader: string | null | undefined
): Promise<EntitledSession> {
  const user = await requireAppUser(cookieHeader);
  const subscription = await getSubscriptionState(user.userId);
  if (!subscription.entitled) {
    throw new AppAuthError("SUBSCRIPTION_REQUIRED");
  }
  return { user, subscription };
}

/** Convenience wrapper for handlers that only need the identity. */
export async function requireActiveSubscriptionUser(
  cookieHeader: string | null | undefined
): Promise<AppUser> {
  return (await requireActiveSubscription(cookieHeader)).user;
}

/**
 * State accessor for the customer's own "subscription status" surface. It does
 * not throw for a missing subscription: the page must be able to explain the
 * state and offer sign-out.
 */
export async function getOwnSubscriptionState(
  cookieHeader: string | null | undefined
): Promise<EntitledSession> {
  const user = await requireAppUser(cookieHeader);
  return { user, subscription: await getSubscriptionState(user.userId) };
}
