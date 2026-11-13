/**
 * Firebase Admin SDK boundary. SERVER ONLY.
 *
 * This module is imported exclusively from route handlers and Node scripts.
 * It must never be imported by a client component; the guard below makes an
 * accidental client import fail loudly instead of shipping credentials.
 */

import {
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import {
  getAuth,
  type Auth,
  type DecodedIdToken,
  type UserRecord,
} from "firebase-admin/auth";
import { getFirebaseAdminConfig } from "@/lib/env";

if (typeof window !== "undefined") {
  throw new Error("lib/auth/firebase-admin is server-only.");
}

const ADMIN_APP_NAME = "demandscan-admin";

/** Firebase session cookies may live 5 minutes to 14 days. */
export const APP_SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (existing) return existing;

  const config = getFirebaseAdminConfig();
  return initializeApp(
    {
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
      projectId: config.projectId,
    },
    ADMIN_APP_NAME
  );
}

export function getFirebaseAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<DecodedIdToken> {
  return getFirebaseAdminAuth().verifyIdToken(idToken, true);
}

export async function createAppSessionCookie(
  idToken: string
): Promise<string> {
  return getFirebaseAdminAuth().createSessionCookie(idToken, {
    expiresIn: APP_SESSION_MAX_AGE_MS,
  });
}

export async function verifyAppSessionCookie(
  sessionCookie: string
): Promise<DecodedIdToken> {
  // checkRevoked=true makes suspended/disabled and signed-out users fail after
  // their refresh tokens are revoked.
  return getFirebaseAdminAuth().verifySessionCookie(sessionCookie, true);
}

export async function getFirebaseUser(uid: string): Promise<UserRecord> {
  return getFirebaseAdminAuth().getUser(uid);
}

export async function getFirebaseUserByEmail(
  email: string
): Promise<UserRecord> {
  return getFirebaseAdminAuth().getUserByEmail(email);
}

export async function createFirebaseUser(input: {
  email: string;
  displayName?: string | null;
  emailVerified?: boolean;
}): Promise<UserRecord> {
  return getFirebaseAdminAuth().createUser({
    email: input.email,
    displayName: input.displayName ?? undefined,
    emailVerified: input.emailVerified ?? false,
    // No password is ever set here. Provisioned customers set their own
    // password through the one-time reset link.
  });
}

export async function deleteFirebaseUser(uid: string): Promise<void> {
  await getFirebaseAdminAuth().deleteUser(uid);
}

export async function generatePasswordResetLink(email: string): Promise<string> {
  return getFirebaseAdminAuth().generatePasswordResetLink(email);
}

/** Invalidates every refresh token and outstanding session cookie for a UID. */
export async function revokeFirebaseSessions(uid: string): Promise<void> {
  await getFirebaseAdminAuth().revokeRefreshTokens(uid);
}
