import { getDb } from "@/lib/db";
import { isAppUserRole, isAppUserStatus, type AppUser } from "./types";

export interface AppUserWithIdentity extends AppUser {
  firebaseUid: string | null;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  status: string;
  role: string;
  firebase_uid?: string | null;
}

function mapUserRow(row: UserRow): AppUserWithIdentity {
  if (!isAppUserStatus(row.status) || !isAppUserRole(row.role)) {
    throw new Error("Stored app user has an invalid role or status.");
  }
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    role: row.role,
    firebaseUid: row.firebase_uid ?? null,
  };
}

export async function findAppUserByEmail(
  email: string
): Promise<AppUserWithIdentity | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT u.user_id, u.email, u.display_name, u.status, u.role,
           i.provider_user_id AS firebase_uid
      FROM app_users u
      LEFT JOIN user_identities i
        ON i.user_id = u.user_id AND i.provider = 'FIREBASE'
     WHERE lower(btrim(u.email)) = ${email}
     LIMIT 1
  `) as UserRow[];
  return rows.length ? mapUserRow(rows[0]) : null;
}

export async function findAppUserById(
  userId: string
): Promise<AppUserWithIdentity | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT u.user_id, u.email, u.display_name, u.status, u.role,
           i.provider_user_id AS firebase_uid
      FROM app_users u
      LEFT JOIN user_identities i
        ON i.user_id = u.user_id AND i.provider = 'FIREBASE'
     WHERE u.user_id = ${userId}
     LIMIT 1
  `) as UserRow[];
  return rows.length ? mapUserRow(rows[0]) : null;
}

/** Counts other users who can still administer the application. */
export async function countOtherActiveAdmins(
  excludeUserId: string
): Promise<number> {
  const sql = getDb();
  const rows = (await sql`
    SELECT COUNT(*)::int AS count
      FROM app_users
     WHERE user_id <> ${excludeUserId}
       AND status = 'ACTIVE'
       AND role IN ('ADMIN', 'SUPER_ADMIN')
  `) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

/** Counts other ACTIVE super admins, preserving super-admin capability. */
export async function countOtherActiveSuperAdmins(
  excludeUserId: string
): Promise<number> {
  const sql = getDb();
  const rows = (await sql`
    SELECT COUNT(*)::int AS count
      FROM app_users
     WHERE user_id <> ${excludeUserId}
       AND status = 'ACTIVE'
       AND role = 'SUPER_ADMIN'
  `) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}
