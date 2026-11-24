/**
 * Scan-scope disclosure shown beside the Run action. These mirror the server
 * defaults in app/api/scanner/run/route.ts (the run endpoint is not changed):
 * Nifty 500 universe, a one-year window, and concurrency 5.
 */
export const SCAN_SCOPE = {
  universe: "Nifty 500",
  window: "Past 12 months",
  concurrency: 5,
} as const;

export function scanScopeLabel(symbol?: string): string {
  const target = symbol?.trim() ? symbol.trim().toUpperCase() : SCAN_SCOPE.universe;
  return `${target} · ${SCAN_SCOPE.window} · Concurrency ${SCAN_SCOPE.concurrency}`;
}
