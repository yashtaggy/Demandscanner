/**
 * Internal application identity types.
 *
 * `userId` is always app_users.user_id. A Firebase UID is only ever looked up
 * through user_identities and must never be used as an ownership key.
 */

export const APP_USER_ROLES = ["SUPER_ADMIN", "ADMIN", "CUSTOMER"] as const;
export type AppUserRole = (typeof APP_USER_ROLES)[number];

export const APP_USER_STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"] as const;
export type AppUserStatus = (typeof APP_USER_STATUSES)[number];

export interface AppUser {
  userId: string;
  email: string;
  displayName: string | null;
  status: AppUserStatus;
  role: AppUserRole;
}

/** Public shape safely returned to the browser. */
export interface PublicAppUser {
  userId: string;
  email: string;
  displayName: string | null;
  status: AppUserStatus;
  role: AppUserRole;
}

export type AppAuthFailureReason =
  | "UNAUTHENTICATED"
  | "INVALID_SESSION"
  | "NO_IDENTITY"
  | "AMBIGUOUS_IDENTITY"
  | "SUSPENDED"
  | "DISABLED"
  | "FORBIDDEN"
  | "SUBSCRIPTION_REQUIRED";

export class AppAuthError extends Error {
  readonly reason: AppAuthFailureReason;

  constructor(reason: AppAuthFailureReason) {
    super(reason);
    this.name = "AppAuthError";
    this.reason = reason;
  }
}

export function isAppUserRole(value: unknown): value is AppUserRole {
  return (
    typeof value === "string" &&
    (APP_USER_ROLES as readonly string[]).includes(value)
  );
}

export function isAppUserStatus(value: unknown): value is AppUserStatus {
  return (
    typeof value === "string" &&
    (APP_USER_STATUSES as readonly string[]).includes(value)
  );
}

export function toPublicAppUser(user: AppUser): PublicAppUser {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    role: user.role,
  };
}
