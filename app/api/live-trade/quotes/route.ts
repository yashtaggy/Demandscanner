/**
 * GET /api/live-trade/quotes[?instrumentIds=1,2]
 *
 * Batched market snapshot for the authenticated owner's selected instruments.
 * Ownership comes from the DemandScan app session; the request never supplies
 * an owner. Quotes additionally require the customer's own bound Kite session —
 * a missing or foreign-bound session is BROKER_NOT_CONNECTED, never a fallback.
 * An empty selection returns an empty success response without a provider call
 * or a cooldown claim.
 *
 * This is a read endpoint, but it writes only short-lived cooldown metadata.
 * The claim is committed before the Kite request, so no transaction or row
 * lock is held while the provider is slow.
 */

import type { NextRequest } from "next/server";
import { getBoundKiteSession } from "@/lib/kite-session";
import { LiveTradeError } from "@/lib/live-trade/errors";
import { handleLiveTrade, liveTradeJson } from "@/lib/live-trade/http";
import { parseQuoteQuery } from "@/lib/live-trade/query";
import { getLiveQuotes } from "@/lib/live-trade/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleLiveTrade(req, {}, async ({ ownerId }) => {
    const query = parseQuoteQuery(new URL(req.url).searchParams);
    const session = await getBoundKiteSession(
      req.headers.get("cookie"),
      ownerId
    );
    if (!session) throw new LiveTradeError("BROKER_NOT_CONNECTED");
    return liveTradeJson(
      await getLiveQuotes(ownerId, session, query.instrumentIds)
    );
  });
}
