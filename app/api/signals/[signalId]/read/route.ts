import { type NextRequest } from "next/server";
import { requireCustomer } from "@/lib/auth/session";
import {
  authErrorResponse,
  getClientIp,
  isSameOriginRequest,
  jsonError,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import {
  readSignalsJsonBody,
  signalsErrorResponse,
  signalsJson,
} from "@/lib/signals/http";
import { updateCustomerReadState } from "@/lib/signals/customer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

/**
 * PATCH /api/signals/:signalId/read
 *
 * Body: `{ "isRead": true | false }`. Only the caller's own read_at is written,
 * and only when the signal is assigned to them and still published.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  let actor;
  try {
    actor = await requireCustomer(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await consumeRateLimit(
    `signals-customer-read-state:${actor.userId}:${getClientIp(req)}`,
    120,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many read-state changes. Try again later.");
  }

  const { signalId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await readSignalsJsonBody(req);
  } catch (err) {
    return signalsErrorResponse(err);
  }

  try {
    const state = await updateCustomerReadState(actor, signalId, body);
    return signalsJson({ ok: true, signal: state });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
