import { type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import {
  authErrorResponse,
  getClientIp,
  isSameOriginRequest,
  jsonError,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { signalsErrorResponse, signalsJson } from "@/lib/signals/http";
import { retryFailedRecipients } from "@/lib/signals/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

/**
 * POST /api/admin/signals/:signalId/retry
 *
 * Requeues FAILED recipients whose customer is still active. No email is sent
 * here; the rows are reset for a future dispatcher. Repeated calls are safe.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  let actor;
  try {
    actor = await requireSuperAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await consumeRateLimit(
    `signals-retry:${actor.userId}:${getClientIp(req)}`,
    30,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many retry requests. Try again later.");
  }

  const { signalId } = await ctx.params;

  try {
    return signalsJson({
      ok: true,
      retry: await retryFailedRecipients(actor, signalId),
    });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
