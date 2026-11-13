/**
 * GET /api/stocks
 *
 * Returns stock rows for all matched Nifty 500 constituents with live quotes.
 * Requires an authenticated DemandScan app user.
 *
 * Query parameters (all optional):
 *   search      — Filter by symbol prefix
 *   sort        — "price" | "change" | "changePercent" | "volume" | "symbol" (default: "symbol")
 *   order       — "asc" | "desc" (default: "asc")
 *   filter      — "positive" | "negative" | "all" (default: "all")
 *   minChange   — Minimum absolute % change (e.g. "1.5")
 *   page        — Page number for pagination (default: 1)
 *   pageSize    — Items per page (default: 50, max: 200)
 */

import { type NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/kite-session";
import { requireActiveSubscription } from "@/lib/subscriptions/entitlements";
import { authErrorResponse } from "@/lib/auth/http";
import { getNSEInstruments, getQuotes, buildStockRow } from "@/lib/kite-client";
import { getNifty500FullSymbols, NIFTY500_LAST_UPDATED } from "@/lib/nifty500";
import {
  markMarketDataContextUsed,
  resolveMarketDataContext,
} from "@/lib/market-data/credentials";
import { MarketDataUnavailableError } from "@/lib/market-data/errors";
import type { StockRow } from "@/lib/types";


type SortField = "price" | "change" | "changePercent" | "volume" | "symbol";
type SortOrder = "asc" | "desc";
type Filter = "positive" | "negative" | "all";

function parseIntParam(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseFloatParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

export async function GET(req: NextRequest) {
  // ─── Auth ──────────────────────────────────────────────────────────────────
  const cookieHeader = req.headers.get("cookie");
  try {
    await requireActiveSubscription(cookieHeader);
  } catch (err) {
    return authErrorResponse(err);
  }
  // Optional staging-only fallback; the system connection is preferred.
  const session = await getSessionFromRequest(cookieHeader);

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.toUpperCase().trim() ?? "";
  const sort = (searchParams.get("sort") ?? "symbol") as SortField;
  const order = (searchParams.get("order") ?? "asc") as SortOrder;
  const filter = (searchParams.get("filter") ?? "all") as Filter;
  const minChange = parseFloatParam(searchParams.get("minChange"), 0);
  const page = parseIntParam(searchParams.get("page"), 1, 1, 10000);
  const pageSize = parseIntParam(searchParams.get("pageSize"), 50, 1, 200);

  const validSorts: SortField[] = ["price", "change", "changePercent", "volume", "symbol"];
  const validOrders: SortOrder[] = ["asc", "desc"];
  const validFilters: Filter[] = ["positive", "negative", "all"];

  if (!validSorts.includes(sort) || !validOrders.includes(order) || !validFilters.includes(filter)) {
    return NextResponse.json(
      { error: "Invalid sort, order, or filter parameter.", code: "INVALID_PARAMS" },
      { status: 400 }
    );
  }

  try {
    // ─── Shared market data (system connection, not the customer session) ─────
    const marketData = await resolveMarketDataContext({ provider: "KITE", session });
    const { accessToken, apiKey } = marketData.credentials;

    // ─── Instrument master ────────────────────────────────────────────────────
    const instrumentMap = await getNSEInstruments(accessToken, false, apiKey);
    const nifty500 = getNifty500FullSymbols();

    // Match Nifty 500 symbols against instrument master
    const validSymbols = nifty500.filter((sym) => instrumentMap.has(sym));

    // ─── Batch quote fetch (max 500 per Kite request) ─────────────────────────
    const quotes = await getQuotes(accessToken, validSymbols, apiKey);
    await markMarketDataContextUsed(marketData);

    // ─── Build stock rows ─────────────────────────────────────────────────────
    let stocks: StockRow[] = validSymbols.map((sym) => {
      const instrument = instrumentMap.get(sym)!;
      const quote = quotes.get(sym);
      return buildStockRow(sym, instrument, quote);
    });

    // ─── Apply filters ────────────────────────────────────────────────────────
    if (search) {
      stocks = stocks.filter(
        (s) => s.symbol.startsWith(search) || s.name.toUpperCase().includes(search)
      );
    }

    if (filter === "positive") {
      stocks = stocks.filter((s) => s.changePercent > 0);
    } else if (filter === "negative") {
      stocks = stocks.filter((s) => s.changePercent < 0);
    }

    if (minChange > 0) {
      stocks = stocks.filter((s) => Math.abs(s.changePercent) >= minChange);
    }

    // ─── Sort ────────────────────────────────────────────────────────────────
    stocks.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sort) {
        case "price":
          aVal = a.lastPrice;
          bVal = b.lastPrice;
          break;
        case "change":
          aVal = a.change;
          bVal = b.change;
          break;
        case "changePercent":
          aVal = a.changePercent;
          bVal = b.changePercent;
          break;
        case "volume":
          aVal = a.volume;
          bVal = b.volume;
          break;
        case "symbol":
        default:
          aVal = a.symbol;
          bVal = b.symbol;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return order === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return order === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    // ─── Paginate ─────────────────────────────────────────────────────────────
    const total = stocks.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const paginated = stocks.slice(start, start + pageSize);

    return NextResponse.json(
      {
        ok: true,
        data: paginated,
        meta: {
          total,
          totalPages,
          page,
          pageSize,
          instrumentsLoaded: instrumentMap.size,
          symbolsMatched: validSymbols.length,
          symbolsWithQuotes: stocks.filter((s) => s.hasQuote).length,
          nifty500LastUpdated: NIFTY500_LAST_UPDATED,
          fetchedAt: new Date().toISOString(),
        },
      },
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
    if (message.includes("PermissionException") || message.includes("subscription")) {
      return NextResponse.json(
        { error: "Market-data provider permission denied. Contact an administrator.", code: "MARKET_DATA_PERMISSION_DENIED" },
        { status: 503 }
      );
    }
    console.error("[api/stocks] Error:", message);
    return NextResponse.json(
      { error: "Failed to retrieve stock data.", code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}
