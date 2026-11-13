/**
 * GET /api/admin/market-data/status
 *
 * Operator-only view of the system market-data connection. Returns safe
 * metadata only: never a token, ciphertext, API secret or database URL.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  MARKET_DATA_ADMIN_HEADER,
  verifyMarketDataAdminToken,
} from "@/lib/market-data/admin-auth";
import {
  allowsCustomerSessionFallback,
  getSystemMarketDataMetadata,
} from "@/lib/market-data/credentials";
import { areMarketDataKiteEnvVarsSet } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = verifyMarketDataAdminToken(req.headers.get(MARKET_DATA_ADMIN_HEADER));
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.message, code: auth.code },
      { status: auth.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const metadata = await getSystemMarketDataMetadata("KITE");

  return NextResponse.json(
    {
      ok: true,
      provider: "KITE",
      connection: metadata,
      environment: {
        systemKiteConfigured: areMarketDataKiteEnvVarsSet(),
        customerSessionFallbackAllowed: allowsCustomerSessionFallback(),
        nodeEnv: process.env.NODE_ENV ?? "unknown",
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
