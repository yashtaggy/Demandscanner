/**
 * GET /api/admin/market-data/kite/callback
 *
 * Zerodha redirects here after the operator authenticates the system account.
 * This route is intentionally public (an OAuth redirect cannot carry a custom
 * header), but it only accepts a callback whose single-use state matches the
 * HttpOnly cookie and an unconsumed, unexpired hash in the database.
 *
 * On success the access token is encrypted with AAD bound to the system
 * connection id and provider, then persisted. Tokens are never logged, echoed,
 * or placed in the redirect URL.
 */

import { type NextRequest, NextResponse } from "next/server";
import { KiteConnect } from "kiteconnect";
import { computeKiteTokenExpiry } from "@/lib/kite-session";
import { getAppOrigin, getMarketDataKiteApiKey, getMarketDataKiteApiSecret } from "@/lib/env";
import { saveSystemMarketDataConnection } from "@/lib/market-data/credentials";
import {
  MARKET_DATA_OAUTH_STATE_COOKIE,
  consumeOAuthState,
  oauthStateMatches,
} from "@/lib/market-data/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE_PATH = "/api/admin/market-data/kite";

const SENSITIVE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function safeRedirect(path: string, req: NextRequest): NextResponse {
  let origin: string;
  try {
    origin = getAppOrigin();
  } catch {
    origin = new URL(req.url).origin;
  }
  return NextResponse.redirect(new URL(path, origin), { headers: SENSITIVE_HEADERS });
}

function failure(req: NextRequest, reason: string): NextResponse {
  const response = safeRedirect(
    `/?market_data=error&reason=${encodeURIComponent(reason)}`,
    req
  );
  response.cookies.set(MARKET_DATA_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const requestToken = searchParams.get("request_token")?.trim();
  const state = searchParams.get("state");

  if (status === "failure") {
    console.error("[market-data/kite/callback] provider reported a login failure");
    return failure(req, "provider_login_failed");
  }

  if (!requestToken) return failure(req, "missing_request_token");
  if (!state) return failure(req, "missing_state");

  const cookieState = req.cookies.get(MARKET_DATA_OAUTH_STATE_COOKIE)?.value ?? null;
  if (!oauthStateMatches(cookieState, state)) {
    console.error("[market-data/kite/callback] state does not match the issuing cookie");
    return failure(req, "state_mismatch");
  }

  try {
    const consumed = await consumeOAuthState({ state, provider: "KITE" });
    if (!consumed) {
      console.error("[market-data/kite/callback] state is expired, unknown or already used");
      return failure(req, "state_expired");
    }
  } catch (err) {
    console.error(
      "[market-data/kite/callback] state verification failed:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown"
    );
    return failure(req, "state_unavailable");
  }

  try {
    const apiKey = getMarketDataKiteApiKey();
    const apiSecret = getMarketDataKiteApiSecret();

    const kc = new KiteConnect({ api_key: apiKey });
    const sessionData = await kc.generateSession(requestToken, apiSecret);

    if (!sessionData?.access_token) {
      throw new Error("Token exchange returned no access token.");
    }

    const { connectionId } = await saveSystemMarketDataConnection({
      provider: "KITE",
      accessToken: sessionData.access_token,
      refreshToken: sessionData.refresh_token ? sessionData.refresh_token : null,
      tokenExpiresAt: computeKiteTokenExpiry(),
      apiKey,
      label: "operator-system",
    });

    console.log(`[market-data/kite/callback] system connection ${connectionId} stored`);

    const response = safeRedirect("/?market_data=connected", req);
    response.cookies.set(MARKET_DATA_OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: STATE_COOKIE_PATH,
      maxAge: 0,
    });
    return response;
  } catch (err) {
    // Never log the request token, access token or API secret.
    console.error(
      "[market-data/kite/callback] token exchange or persistence failed:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown"
    );
    return failure(req, "connection_failed");
  }
}
