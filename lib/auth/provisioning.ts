/**
 * Administrative user lifecycle. SERVER ONLY.
 *
 * Firebase owns credentials; PostgreSQL owns identity, role, status and audit.
 * Every mutation is written to admin_audit_log in the same transaction as the
 * change. Password-reset links are returned to the initiating admin only and
 * are never logged or stored.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import {
  createFirebaseUser,
  deleteFirebaseUser,
  generatePasswordResetLink,
  getFirebaseUserByEmail,
  revokeFirebaseSessions,
} from "./firebase-admin";
import {
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
} from "./normalize";
import {
  countOtherActiveAdmins,
  countOtherActiveSuperAdmins,
  findAppUserByEmail,
  findAppUserById,
} from "./repository";
import {
  isAppUserStatus,
  type AppUser,
  type AppUserRole,
} from "./types";

export class ProvisioningError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProvisioningError";
    this.status = status;
    this.code = code;
  }
}

export interface ProvisionCustomerResult {
  user: AppUser;
  /** Shown once to the initiating admin. Never logged or persisted. */
  resetLink: string;
}

function firebaseCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code?: unknown }).code ?? "");
  }
  return "";
}

function isUniqueViolation(err: unknown): boolean {
  return (
    firebaseCode(err) === "23505" ||
    (err instanceof Error && /duplicate key|unique constraint/i.test(err.message))
  );
}

function publicUser(user: AppUser): AppUser {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    role: user.role,
  };
}

export async function provisionCustomer(
  actor: AppUser,
  input: { email?: unknown; displayName?: unknown }
): Promise<ProvisionCustomerResult> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new ProvisioningError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }

  // Both branches are clamped to the 120-character column constraint; the
  // email local part is not bounded by the email validator on its own.
  const displayName =
    normalizeDisplayName(input.displayName) ??
    normalizeDisplayName(email.split("@")[0]);

  const existing = await findAppUserByEmail(email);
  if (existing) {
    throw new ProvisioningError(
      409,
      "EMAIL_EXISTS",
      "A user with this email already exists."
    );
  }

  try {
    const firebaseExisting = await getFirebaseUserByEmail(email);
    if (firebaseExisting) {
      throw new ProvisioningError(
        409,
        "FIREBASE_EMAIL_EXISTS",
        "This email already has a Firebase account that is not linked to DemandScan. Resolve it before provisioning."
      );
    }
  } catch (err) {
    if (err instanceof ProvisioningError) throw err;
    if (firebaseCode(err) !== "auth/user-not-found") {
      throw new ProvisioningError(
        502,
        "FIREBASE_UNAVAILABLE",
        "Firebase could not be reached. No account was created."
      );
    }
  }

  let firebaseUid: string | null = null;
  try {
    const created = await createFirebaseUser({
      email,
      displayName,
      emailVerified: false,
    });
    firebaseUid = created.uid;

    // Generate the one-time link before committing so a failure can be
    // compensated without leaving a half-provisioned account.
    const resetLink = await generatePasswordResetLink(email);

    const userId = randomUUID();
    const sql = getDb();
    await sql.transaction([
      sql`
        INSERT INTO app_users (user_id, email, display_name, role, status)
        VALUES (${userId}, ${email}, ${displayName}, 'CUSTOMER', 'ACTIVE')
      `,
      sql`
        INSERT INTO user_identities (identity_id, user_id, provider, provider_user_id)
        VALUES (${randomUUID()}, ${userId}, 'FIREBASE', ${firebaseUid})
      `,
      sql`
        INSERT INTO admin_audit_log (
          audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata
        )
        VALUES (
          ${randomUUID()}, ${actor.userId}, 'CUSTOMER_PROVISIONED', 'app_user',
          ${userId}, ${JSON.stringify({ email, firebaseUid })}::jsonb
        )
      `,
    ]);

    return {
      user: {
        userId,
        email,
        displayName,
        status: "ACTIVE",
        role: "CUSTOMER",
      },
      resetLink,
    };
  } catch (err) {
    if (firebaseUid) {
      try {
        await deleteFirebaseUser(firebaseUid);
      } catch (cleanupErr) {
        console.error(
          "[auth] failed to compensate Firebase user:",
          firebaseCode(cleanupErr) || "unknown"
        );
      }
    }

    if (err instanceof ProvisioningError) throw err;
    if (isUniqueViolation(err)) {
      throw new ProvisioningError(
        409,
        "EMAIL_EXISTS",
        "A user with this email already exists."
      );
    }
    console.error(
      "[auth] customer provisioning failed:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown"
    );
    throw new ProvisioningError(
      500,
      "PROVISIONING_FAILED",
      "The customer account could not be created. No account was kept."
    );
  }
}

export async function setUserStatus(
  actor: AppUser,
  targetUserId: string,
  rawStatus: unknown,
  rawReason?: unknown
): Promise<AppUser> {
  if (!isAppUserStatus(rawStatus)) {
    throw new ProvisioningError(400, "INVALID_STATUS", "Unknown status value.");
  }
  const status = rawStatus;

  let reason: string | null = null;
  if (rawReason !== undefined && rawReason !== null) {
    if (typeof rawReason !== "string") {
      throw new ProvisioningError(400, "INVALID_REASON", "Reason must be text.");
    }
    reason = rawReason.trim().replace(/\s+/g, " ");
    if (reason.length > 500) {
      throw new ProvisioningError(400, "INVALID_REASON", "Reason is too long.");
    }
    if (reason.length === 0) reason = null;
  }

  const target = await findAppUserById(targetUserId);
  if (!target) {
    throw new ProvisioningError(404, "USER_NOT_FOUND", "User not found.");
  }

  if (actor.role !== "SUPER_ADMIN" && target.role !== "CUSTOMER") {
    throw new ProvisioningError(
      403,
      "FORBIDDEN",
      "Only a super admin can manage administrator accounts."
    );
  }

  if (target.status === status) {
    return target;
  }

  if (status !== "ACTIVE" && target.role === "SUPER_ADMIN") {
    if ((await countOtherActiveSuperAdmins(target.userId)) === 0) {
      throw new ProvisioningError(
        409,
        "LAST_SUPER_ADMIN",
        "This is the last active super admin and cannot be suspended or disabled."
      );
    }
  } else if (status !== "ACTIVE" && target.role === "ADMIN") {
    if ((await countOtherActiveAdmins(target.userId)) === 0) {
      throw new ProvisioningError(
        409,
        "LAST_ADMIN",
        "This is the last active administrator and cannot be suspended or disabled."
      );
    }
  }

  const action =
    status === "ACTIVE"
      ? "USER_ENABLED"
      : status === "SUSPENDED"
        ? "USER_SUSPENDED"
        : "USER_DISABLED";

  const sql = getDb();
  await sql.transaction([
    sql`UPDATE app_users SET status = ${status}, updated_at = NOW() WHERE user_id = ${target.userId}`,
    sql`
      INSERT INTO admin_audit_log (
        audit_id, actor_user_id, action, target_entity_type,
        target_entity_id, metadata
      )
      VALUES (
        ${randomUUID()}, ${actor.userId}, ${action}, 'app_user',
        ${target.userId},
        ${JSON.stringify({ from: target.status, to: status, reason })}::jsonb
      )
    `,
  ]);

  if (status !== "ACTIVE" && target.firebaseUid) {
    try {
      await revokeFirebaseSessions(target.firebaseUid);
    } catch (err) {
      // Database status is authoritative, so the user is blocked either way.
      console.warn(
        "[auth] failed to revoke Firebase sessions:",
        firebaseCode(err) || "unknown"
      );
    }
  }

  return publicUser({ ...target, status });
}

export async function setUserRole(
  actor: AppUser,
  targetUserId: string,
  rawRole: unknown
): Promise<AppUser> {
  if (actor.role !== "SUPER_ADMIN") {
    throw new ProvisioningError(
      403,
      "FORBIDDEN",
      "Only a super admin can change roles."
    );
  }
  if (rawRole !== "ADMIN" && rawRole !== "CUSTOMER") {
    throw new ProvisioningError(
      400,
      "ROLE_NOT_ASSIGNABLE",
      "Only ADMIN and CUSTOMER can be assigned here."
    );
  }
  const role: AppUserRole = rawRole;

  if (targetUserId === actor.userId) {
    throw new ProvisioningError(
      403,
      "SELF_ROLE_CHANGE",
      "You cannot change your own role."
    );
  }

  const target = await findAppUserById(targetUserId);
  if (!target) {
    throw new ProvisioningError(404, "USER_NOT_FOUND", "User not found.");
  }
  if (target.role === role) return target;

  if (target.role === "SUPER_ADMIN") {
    if ((await countOtherActiveSuperAdmins(target.userId)) === 0) {
      throw new ProvisioningError(
        409,
        "LAST_SUPER_ADMIN",
        "This is the last super admin and cannot be demoted."
      );
    }
  }

  const sql = getDb();
  await sql.transaction([
    sql`UPDATE app_users SET role = ${role}, updated_at = NOW() WHERE user_id = ${target.userId}`,
    sql`
      INSERT INTO admin_audit_log (
        audit_id, actor_user_id, action, target_entity_type,
        target_entity_id, metadata
      )
      VALUES (
        ${randomUUID()}, ${actor.userId}, 'USER_ROLE_CHANGED', 'app_user',
        ${target.userId}, ${JSON.stringify({ from: target.role, to: role })}::jsonb
      )
    `,
  ]);

  return publicUser({ ...target, role });
}
