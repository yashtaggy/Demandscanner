import { NextResponse, type NextRequest } from "next/server";
import { revokeFirebaseSessions } from "@/lib/auth/firebase-admin";
import { clearAppSessionCookie } from "@/lib/auth/cookies";
import {
  NO_STORE_HEADERS,
  authErrorResponse,
  isSameOriginRequest,
  jsonError,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { requireAppUserSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/session/logout-all
 *
 * Explicit "sign out everywhere": revokes the user's Firebase refresh tokens,
 * which invalidates this session and every other device's session on their
 * next request. Normal logout (DELETE /api/auth/session) only clears the
 * current browser's cookie and must not use this route.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  let session;
  try {
    session = await requireAppUserSession(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await consumeRateLimit(
    `logout-all:${session.user.userId}`,
    10,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many sign-out requests. Try again later.");
  }

  try {
    await revokeFirebaseSessions(session.firebaseUid);
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code ?? "unknown")
        : "unknown";
    console.error("[auth] logout-all revocation failed:", code);
    return jsonError(
      502,
      "LOGOUT_ALL_FAILED",
      "Signing out of other devices could not be completed. Try again."
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  clearAppSessionCookie(response);
  return response;
}
