import { NextResponse, type NextRequest } from "next/server";
import { createAppSessionCookie, verifyFirebaseIdToken } from "@/lib/auth/firebase-admin";
import { requireAppUser, findAppUserByFirebaseUid } from "@/lib/auth/session";
import {
  clearAppSessionCookie,
  setAppSessionCookie,
} from "@/lib/auth/cookies";
import {
  NO_STORE_HEADERS,
  getClientIp,
  isSameOriginRequest,
  jsonError,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { toPublicAppUser } from "@/lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the current internal app user, or 401. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAppUser(req.headers.get("cookie"));
    return NextResponse.json(
      { authenticated: true, user: toPublicAppUser(user) },
      { headers: NO_STORE_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { authenticated: false, user: null },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * Exchanges a Firebase ID token for a server session cookie.
 * The browser never receives an internal user id from anywhere except this
 * response, and ownership still resolves from user_identities.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  const ip = getClientIp(req);
  const limit = await consumeRateLimit(`session:ip:${ip}`, 30, 300);
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many sign-in attempts. Try again later.");
  }

  let body: { idToken?: unknown };
  try {
    body = (await req.json()) as { idToken?: unknown };
  } catch {
    return jsonError(400, "INVALID_BODY", "A JSON body with idToken is required.");
  }

  const idToken = typeof body.idToken === "string" ? body.idToken : "";
  if (idToken.length < 100 || idToken.length > 20_000) {
    return jsonError(400, "INVALID_TOKEN", "A valid Firebase ID token is required.");
  }

  let uid: string;
  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return jsonError(401, "INVALID_TOKEN", "The Firebase session could not be verified.");
  }

  let user;
  try {
    user = await findAppUserByFirebaseUid(uid);
  } catch {
    return jsonError(
      403,
      "ACCESS_DENIED",
      "This account is not provisioned for DemandScan."
    );
  }

  if (user.status !== "ACTIVE") {
    return jsonError(403, "ACCESS_DENIED", "This account is not active.");
  }

  let sessionCookie: string;
  try {
    sessionCookie = await createAppSessionCookie(idToken);
  } catch {
    return jsonError(401, "INVALID_TOKEN", "The Firebase session could not be created.");
  }

  const response = NextResponse.json(
    { authenticated: true, user: toPublicAppUser(user) },
    { headers: NO_STORE_HEADERS }
  );
  setAppSessionCookie(response, sessionCookie);
  return response;
}

export async function DELETE(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  clearAppSessionCookie(response);
  return response;
}
