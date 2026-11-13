/**
 * GET /api/stocks/[symbol]
 *
 * Returns detailed quote data for a single stock.
 * symbol param: the trading symbol without exchange prefix (e.g. "INFY")
 * Exchange is always assumed to be NSE for this application.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/kite-session";
import { requireActiveSubscription } from "@/lib/subscriptions/entitlements";
import { authErrorResponse } from "@/lib/auth/http";
import { getNSEInstruments, getQuotes, buildStockRow } from "@/lib/kite-client";
import {
  markMarketDataContextUsed,
  resolveMarketDataContext,
} from "@/lib/market-data/credentials";
import { MarketDataUnavailableError } from "@/lib/market-data/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9&\-]{1,20}$/;

interface RouteContext {
  params: Promise<{ symbol: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { symbol: rawSymbol } = await ctx.params;
  const symbol = rawSymbol?.toUpperCase().trim();

  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json(
      { error: "Invalid symbol. Use only letters, numbers, hyphens, and ampersands.", code: "INVALID_SYMBOL" },
      { status: 400 }
    );
  }

  const cookieHeader = req.headers.get("cookie");
  try {
    await requireActiveSubscription(cookieHeader);
  } catch (err) {
    return authErrorResponse(err);
  }
  // Optional staging-only fallback; the system connection is preferred.
  const session = await getSessionFromRequest(cookieHeader);

  const fullSymbol = `NSE:${symbol}`;

  try {
    const marketData = await resolveMarketDataContext({ provider: "KITE", session });
    const { accessToken, apiKey } = marketData.credentials;

    const instruments = await getNSEInstruments(accessToken, false, apiKey);
    const instrument = instruments.get(fullSymbol);

    if (!instrument) {
      return NextResponse.json(
        { error: `Instrument not found: ${symbol}. Not in NSE EQ segment or Kite instrument master.`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const quotes = await getQuotes(accessToken, [fullSymbol], apiKey);
    await markMarketDataContextUsed(marketData);
    const quote = quotes.get(fullSymbol);
    const stockRow = buildStockRow(fullSymbol, instrument, quote);

    return NextResponse.json(
      { ok: true, data: stockRow, quote: quote ?? null },
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
    if (message.includes("TokenException")) {
      return NextResponse.json(
        { error: "Market-data provider credentials expired. Contact an administrator.", code: "MARKET_DATA_AUTH_EXPIRED" },
        { status: 503 }
      );
    }
    console.error(`[api/stocks/${symbol}] Error:`, message);
    return NextResponse.json(
      { error: "Failed to retrieve stock data.", code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}
