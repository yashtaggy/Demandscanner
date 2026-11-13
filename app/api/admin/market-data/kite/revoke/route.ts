/**
 * POST /api/admin/market-data/kite/revoke
 *
 * Operator-only revocation of the system Kite connection. The row is kept for
 * audit (status REVOKED) and the refresh token ciphertext is discarded.
 * Customer sessions in kite_sessions are unaffected.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  MARKET_DATA_ADMIN_HEADER,
  verifyMarketDataAdminToken,
} from "@/lib/market-data/admin-auth";
import { revokeSystemMarketDataConnection } from "@/lib/market-data/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = verifyMarketDataAdminToken(req.headers.get(MARKET_DATA_ADMIN_HEADER));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message, code: auth.code },
      { status: auth.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const revoked = await revokeSystemMarketDataConnection("KITE");

  return NextResponse.json(
    { ok: true, provider: "KITE", revoked },
    { headers: { "Cache-Control": "no-store" } }
  );
}
