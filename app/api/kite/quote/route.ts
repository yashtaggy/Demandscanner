/**
 * GET /api/kite/quote?symbol=NSE:INFY
 *
 * Returns a live quote for a single instrument.
 * Requires an authenticated DemandScan app user.
 *
 * Query params:
 *   symbol  — Required. Format: "EXCHANGE:TRADINGSYMBOL" (e.g. NSE:INFY)
 *
 * Returns clean JSON — never raw Kite responses, stack traces, or secrets.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/kite-session";
import { requireActiveSubscription } from "@/lib/subscriptions/entitlements";
import { authErrorResponse } from "@/lib/auth/http";
import { getQuotes } from "@/lib/kite-client";
import {
  markMarketDataContextUsed,
  resolveMarketDataContext,
} from "@/lib/market-data/credentials";
import { MarketDataUnavailableError } from "@/lib/market-data/errors";


// Allowed pattern: EXCHANGE:SYMBOL (alphanumeric, hyphens, ampersands)
const SYMBOL_PATTERN = /^[A-Z]{2,10}:[A-Z0-9&\-]{1,20}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.toUpperCase().trim();

  // ─── Input validation ──────────────────────────────────────────────────────
  if (!symbol) {
    return NextResponse.json(
      { error: "Missing required query parameter: symbol", code: "MISSING_SYMBOL" },
      { status: 400 }
    );
  }

  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json(
      {
        error:
          "Invalid symbol format. Expected EXCHANGE:TRADINGSYMBOL (e.g. NSE:INFY).",
        code: "INVALID_SYMBOL",
      },
      { status: 400 }
    );
  }

  // ─── Auth check ────────────────────────────────────────────────────────────
  const cookieHeader = req.headers.get("cookie");
  try {
    await requireActiveSubscription(cookieHeader);
  } catch (err) {
    return authErrorResponse(err);
  }
  // Optional staging-only fallback; the system connection is preferred.
  const session = await getSessionFromRequest(cookieHeader);

  // ─── Fetch quote ───────────────────────────────────────────────────────────
  try {
    const marketData = await resolveMarketDataContext({ provider: "KITE", session });
    const quotes = await getQuotes(
      marketData.credentials.accessToken,
      [symbol],
      marketData.credentials.apiKey
    );
    await markMarketDataContextUsed(marketData);
    const quote = quotes.get(symbol);

    if (!quote) {
      return NextResponse.json(
        { error: `No quote data returned for symbol: ${symbol}`, code: "NO_DATA" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { ok: true, symbol, data: quote },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof MarketDataUnavailableError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";

    // Classify Kite API errors without leaking internals
    if (message.includes("TokenException") || message.includes("token")) {
      return NextResponse.json(
        { error: "Market-data provider credentials expired. Contact an administrator.", code: "MARKET_DATA_AUTH_EXPIRED" },
        { status: 503 }
      );
    }
    if (message.includes("PermissionException") || message.includes("subscription")) {
      return NextResponse.json(
        { error: "Market-data provider permission denied. Contact an administrator.", code: "MARKET_DATA_PERMISSION_DENIED" },
        { status: 503 }
      );
    }
    if (message.includes("NetworkException") || message.includes("ECONNREFUSED")) {
      return NextResponse.json(
        { error: "Network error contacting Kite Connect.", code: "NETWORK_ERROR" },
        { status: 502 }
      );
    }
    // Only classify as invalid instrument when the error is clearly about the symbol,
    // not a generic "Invalid" which could be auth-related.
    if (message.includes("InputException")) {
      return NextResponse.json(
        { error: `Invalid instrument: ${symbol}`, code: "INVALID_INSTRUMENT" },
        { status: 400 }
      );
    }

    console.error(`[kite/quote] Unhandled error for ${symbol}:`, message);
    return NextResponse.json(
      { error: "Failed to retrieve quote.", code: "QUOTE_ERROR" },
      { status: 500 }
    );
  }
}
