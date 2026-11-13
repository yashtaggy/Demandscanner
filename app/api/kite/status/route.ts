/**
 * GET /api/kite/status
 *
 * Reports broker connectivity for the current DemandScan app user. The Kite
 * session is returned only when this browser's ds_sid cookie is bound to the
 * authenticated app user, so a shared cookie can never report another
 * customer's Kite connection.
 *
 * NEVER returns the access token, API key, API secret, or encryption key.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getBoundKiteSession } from "@/lib/kite-session";
import { getAppUser } from "@/lib/auth/session";
import { areKiteEnvVarsSet, isDatabaseConfigured } from "@/lib/env";
import { getNSEMarketStatus } from "@/lib/kite-client";
import type { AuthStatus } from "@/lib/types";

export async function GET(req: NextRequest) {
  const cookieHeader = req.headers.get("cookie");
  const appUser = await getAppUser(cookieHeader);
  const session = appUser
    ? await getBoundKiteSession(cookieHeader, appUser.userId)
    : null;
  const marketStatus = getNSEMarketStatus();

  const authStatus: AuthStatus & {
    envConfigured: boolean;
    dbConfigured: boolean;
    market: typeof marketStatus;
  } = {
    authenticated: session !== null,
    userId: session?.userId,
    userName: session?.userName,
    loginTime: session?.loginTime,
    expiresAt: session?.expiresAt,
    sessionValid: session !== null,
    envConfigured: areKiteEnvVarsSet(),
    dbConfigured: isDatabaseConfigured(),
    market: marketStatus,
  };

  return NextResponse.json(authStatus, {
    headers: { "Cache-Control": "no-store" },
  });
}
