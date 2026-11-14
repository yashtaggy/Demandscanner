import { type NextRequest } from "next/server";
import { jsonError } from "@/lib/auth/http";
import { verifyDispatchAuthorization } from "@/lib/signals/cron-auth";
import { dispatchDueSignals } from "@/lib/signals/dispatcher";
import { resolveSignalsEmailConfig } from "@/lib/signals/email-config";
import { createSignalsEmailTransport } from "@/lib/signals/email-transport";
import { signalsJson } from "@/lib/signals/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function failureReason(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code?: unknown }).code ?? "unknown").slice(0, 40);
  }
  return err instanceof Error ? err.name : "unknown";
}

/**
 * POST /api/internal/signals/dispatch
 *
 * Scheduled entry point. Authorization is a Bearer token matching CRON_SECRET;
 * browser sessions and caller-supplied work are never accepted. The response
 * contains counts only, never addresses, credentials or transport details.
 */
export async function POST(req: NextRequest) {
  const auth = verifyDispatchAuthorization(req.headers.get("authorization"));
  if (!auth.ok) {
    return jsonError(auth.status, auth.code, auth.message);
  }

  const resolved = resolveSignalsEmailConfig();
  if (!resolved.ok) {
    console.error(
      "[signals] email dispatch configuration is incomplete:",
      resolved.problems.join(" ")
    );
    return jsonError(
      503,
      "EMAIL_NOT_CONFIGURED",
      "Signals email delivery is not configured."
    );
  }

  const transport = createSignalsEmailTransport(resolved.config);

  try {
    const dispatch = await dispatchDueSignals({
      config: resolved.config,
      transport,
    });
    return signalsJson({
      ok: true,
      dispatch,
      ranAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[signals] dispatch failed:", failureReason(err));
    return jsonError(
      503,
      "DISPATCH_UNAVAILABLE",
      "Signal dispatch is temporarily unavailable."
    );
  }
}
