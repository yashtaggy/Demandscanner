/**
 * POST /api/admin/market-data/kite/login
 *
 * Operator-only start of the system Kite connection OAuth flow.
 *
 * The operator token is read from a header, never from a query string, and the
 * response returns the Kite login URL instead of redirecting. Returning JSON
 * avoids forwarding the operator header to Zerodha on a cross-origin redirect.
 *
 * A cryptographically random single-use state is stored twice:
 *   * plaintext in an HttpOnly cookie scoped to the callback path
 *   * SHA-256 hash in market_data_oauth_states
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  MARKET_DATA_ADMIN_HEADER,
  verifyMarketDataAdminToken,
} from "@/lib/market-data/admin-auth";
import {
  MARKET_DATA_OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  createOAuthState,
  persistOAuthState,
} from "@/lib/market-data/oauth-state";
import {
  areMarketDataKiteEnvVarsSet,
  getMarketDataKiteApiKey,
} from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const STATE_COOKIE_PATH = "/api/admin/market-data/kite";

export async function POST(req: NextRequest) {
  const auth = verifyMarketDataAdminToken(req.headers.get(MARKET_DATA_ADMIN_HEADER));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message, code: auth.code },
      { status: auth.status, headers: NO_STORE_HEADERS }
    );
  }

  if (!areMarketDataKiteEnvVarsSet()) {
    return NextResponse.json(
      {
        error:
          "System market-data Kite credentials are not configured. Set MARKET_DATA_KITE_API_KEY, " +
          "MARKET_DATA_KITE_API_SECRET and MARKET_DATA_KITE_REDIRECT_URL.",
        code: "MARKET_DATA_KITE_NOT_CONFIGURED",
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  const state = createOAuthState();
  await persistOAuthState({ state, provider: "KITE", ttlMs: OAUTH_STATE_TTL_MS });

  const apiKey = getMarketDataKiteApiKey();
  const redirectParams = encodeURIComponent(`state=${state}`);
  const loginUrl =
    `https://kite.trade/connect/login?api_key=${encodeURIComponent(apiKey)}` +
    `&v=3&redirect_params=${redirectParams}`;

  const response = NextResponse.json(
    {
      ok: true,
      loginUrl,
      expiresInSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
      note:
        "Open loginUrl in the same browser profile that made this request; the " +
        "callback requires the state cookie set by this response.",
    },
    { headers: NO_STORE_HEADERS }
  );

  response.cookies.set(MARKET_DATA_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });

  return response;
}
