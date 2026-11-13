/**
 * GET /api/kite/callback
 *
 * Zerodha redirects here after successful authentication with:
 *   ?request_token=<token>&action=login&status=success
 *
 * This route:
 *  1. Handles Zerodha-reported login failures.
 *  2. Validates the request_token parameter.
 *  3. Exchanges the request_token for an access_token using the Kite SDK (server-side).
 *  4. Validates the returned access_token.
 *  5. Persists the encrypted access_token in Neon Postgres.
 *  6. Issues a cryptographically random, opaque session ID in an HttpOnly cookie.
 *  7. Redirects to the dashboard ONLY after persistence succeeds.
 *  8. On any failure, redirects with a generic, non-sensitive error code.
 *
 * Security invariants:
 *  - Access token, request token, and API secret NEVER reach the browser.
 *  - The cookie contains only a random opaque ID — no credentials.
 *  - The database stores only the SHA-256 hash of the session ID plus the
 *    AES-256-GCM encrypted access token.
 *  - Redirect target is always the canonical app origin (no open redirect).
 */

import { type NextRequest, NextResponse } from "next/server";
import { KiteConnect } from "kiteconnect";
import { randomUUID } from "crypto";
import { getKiteApiKey, getKiteApiSecret, getAppOrigin } from "@/lib/env";
import {
  sessionStore,
  computeKiteTokenExpiry,
  bindSessionToAppUser,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/kite-session";
import { getAppUser } from "@/lib/auth/session";
import type { KiteSession } from "@/lib/types";

const SENSITIVE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/** Safe redirect to our own origin; prevents open redirect. */
function safeRedirect(path: string, req: NextRequest): NextResponse {
  // Use the configured origin when available; fall back to request origin
  let origin: string;
  try {
    origin = getAppOrigin();
  } catch {
    origin = new URL(req.url).origin;
  }
  return NextResponse.redirect(new URL(path, origin), {
    headers: SENSITIVE_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  // A Kite connection is always started from an authenticated DemandScan app
  // session and is bound to that internal user. Kite identity never becomes an
  // ownership key.
  const appUser = await getAppUser(req.headers.get("cookie"));
  if (!appUser) {
    return safeRedirect("/login?next=%2Fapi%2Fkite%2Flogin", req);
  }

  const { searchParams } = new URL(req.url);

  const status = searchParams.get("status");
  const requestToken = searchParams.get("request_token");
  const errorType = searchParams.get("error_type");
  const errorMessage = searchParams.get("message");

  // ─── Handle Zerodha-side errors ─────────────────────────────────────────────
  if (status === "failure" || errorType) {
    console.error(
      `[kite/callback] Zerodha login failed: type=${errorType} message=${errorMessage}`
    );
    return safeRedirect(
      `/?auth_error=${encodeURIComponent(errorType ?? "login_failed")}`,
      req
    );
  }

  // ─── Validate request_token ──────────────────────────────────────────────────
  if (!requestToken || requestToken.trim() === "") {
    console.error("[kite/callback] Missing request_token parameter.");
    return safeRedirect("/?auth_error=missing_token", req);
  }

  // ─── Exchange request_token for access_token ─────────────────────────────────
  let createdSessionId: string | null = null;
  try {
    const apiKey = getKiteApiKey();
    const apiSecret = getKiteApiSecret();

    const kc = new KiteConnect({ api_key: apiKey });
    // generateSession() computes HMAC-SHA256(api_key+request_token+api_secret)
    // and exchanges it with Zerodha for an access_token.
    const sessionData = await kc.generateSession(requestToken.trim(), apiSecret);

    if (!sessionData?.access_token) {
      throw new Error("generateSession returned no access_token.");
    }

    const expiresAt = computeKiteTokenExpiry();

    const kiteSession: KiteSession = {
      accessToken: sessionData.access_token,
      userId: sessionData.user_id ?? "",
      userName: sessionData.user_name ?? "",
      email: sessionData.email ?? "",
      loginTime: sessionData.login_time
        ? new Date(sessionData.login_time).toISOString()
        : new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    // ─── Generate opaque session ID ────────────────────────────────────────────
    // randomUUID() is cryptographically secure (uses /dev/urandom / CryptGenRandom)
    const sessionId = randomUUID();
    createdSessionId = sessionId;

    // ─── Persist to database ───────────────────────────────────────────────────
    await sessionStore.set(sessionId, kiteSession);
    await bindSessionToAppUser(sessionId, appUser.userId);

    console.log(
      `[kite/callback] Kite session bound to app user expires=${kiteSession.expiresAt}`
    );

    // ─── Issue secure cookie and redirect ─────────────────────────────────────
    const response = safeRedirect("/", req);

    // Set-Cookie: ds_sid=<random-uuid>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400
    response.cookies.set(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Log safely — never log request_token, access_token, or api_secret
    console.error(`[kite/callback] Session generation failed: ${message}`);

    if (createdSessionId) {
      await sessionStore.clear(createdSessionId).catch(() => undefined);
    }

    return safeRedirect("/?auth_error=session_failed", req);
  }
}
