/**
 * Central application authorization. SERVER ONLY.
 *
 * Every protected server request funnels through requireAppUser(), which:
 *   1. verifies the Firebase session cookie (including revocation),
 *   2. maps the Firebase UID to app_users through user_identities,
 *   3. reads role and status from PostgreSQL on every request.
 *
 * Roles and status are never trusted from the browser or from Firebase claims.
 */

import { getDb } from "@/lib/db";
import {
  AppAuthError,
  isAppUserRole,
  isAppUserStatus,
  type AppUser,
  type AppUserRole,
} from "./types";
import { verifyAppSessionCookie } from "./firebase-admin";
import { getAppSessionCookie } from "./cookies";

interface AppUserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  status: string;
  role: string;
}

function mapRow(row: AppUserRow): AppUser {
  if (!isAppUserStatus(row.status) || !isAppUserRole(row.role)) {
    throw new AppAuthError("INVALID_SESSION");
  }
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    role: row.role,
  };
}

/**
 * Resolve an internal app user from a Firebase UID.
 * Fails closed on missing or ambiguous identity mappings.
 */
export async function findAppUserByFirebaseUid(uid: string): Promise<AppUser> {
  if (!uid) throw new AppAuthError("NO_IDENTITY");

  const sql = getDb();
  const rows = (await sql`
    SELECT u.user_id, u.email, u.display_name, u.status, u.role
      FROM user_identities i
      JOIN app_users u ON u.user_id = i.user_id
     WHERE i.provider = 'FIREBASE'
       AND i.provider_user_id = ${uid}
  `) as AppUserRow[];

  if (rows.length === 0) throw new AppAuthError("NO_IDENTITY");
  if (rows.length > 1) throw new AppAuthError("AMBIGUOUS_IDENTITY");

  return mapRow(rows[0]);
}

/**
 * Resolve the current app user from a request cookie header.
 * Returns null for every failure so callers can render an unauthenticated view.
 */
export async function getAppUser(
  cookieHeader: string | null | undefined
): Promise<AppUser | null> {
  try {
    return await requireAppUser(cookieHeader);
  } catch {
    return null;
  }
}

export interface AppUserSession {
  user: AppUser;
  /** Firebase UID from the verified session cookie. Never an ownership key. */
  firebaseUid: string;
}

/**
 * Like requireAppUser(), but also returns the verified Firebase UID. Only
 * operations that must act on the Firebase account itself (for example a
 * logout-everywhere revocation) need it.
 */
export async function requireAppUserSession(
  cookieHeader: string | null | undefined
): Promise<AppUserSession> {
  const sessionCookie = getAppSessionCookie(cookieHeader);
  if (!sessionCookie) throw new AppAuthError("UNAUTHENTICATED");

  let uid: string;
  try {
    const decoded = await verifyAppSessionCookie(sessionCookie);
    uid = decoded.uid;
  } catch {
    throw new AppAuthError("INVALID_SESSION");
  }

  const user = await findAppUserByFirebaseUid(uid);
  if (user.status === "SUSPENDED") throw new AppAuthError("SUSPENDED");
  if (user.status === "DISABLED") throw new AppAuthError("DISABLED");
  if (user.status !== "ACTIVE") throw new AppAuthError("INVALID_SESSION");

  return { user, firebaseUid: uid };
}

export async function requireAppUser(
  cookieHeader: string | null | undefined
): Promise<AppUser> {
  return (await requireAppUserSession(cookieHeader)).user;
}

export async function requireAdmin(
  cookieHeader: string | null | undefined
): Promise<AppUser> {
  const user = await requireAppUser(cookieHeader);
  return assertRole(user, ["ADMIN", "SUPER_ADMIN"]);
}

/**
 * Customer-only gate for customer-facing APIs. Admins are deliberately rejected:
 * staff accounts must never reach customer data through a customer endpoint.
 */
export async function requireCustomer(
  cookieHeader: string | null | undefined
): Promise<AppUser> {
  const user = await requireAppUser(cookieHeader);
  return assertRole(user, ["CUSTOMER"]);
}

export async function requireSuperAdmin(
  cookieHeader: string | null | undefined
): Promise<AppUser> {
  const user = await requireAppUser(cookieHeader);
  return assertRole(user, ["SUPER_ADMIN"]);
}

function assertRole(user: AppUser, allowed: readonly AppUserRole[]): AppUser {
  if (!allowed.includes(user.role)) {
    throw new AppAuthError("FORBIDDEN");
  }
  return user;
}
