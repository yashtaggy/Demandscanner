import { type NextRequest } from "next/server";
import { requireCustomer } from "@/lib/auth/session";
import {
  authErrorResponse,
  getClientIp,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { signalsErrorResponse, signalsJson } from "@/lib/signals/http";
import { customerSignal } from "@/lib/signals/customer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

/**
 * GET /api/signals/:signalId
 *
 * The full message and this customer's read state. Ownership is checked in the
 * database query; a signal assigned to someone else is indistinguishable from
 * a signal that does not exist.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  let actor;
  try {
    actor = await requireCustomer(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await consumeRateLimit(
    `signals-customer-read:${actor.userId}:${getClientIp(req)}`,
    600,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many signal lookups. Try again later.");
  }

  const { signalId } = await ctx.params;

  try {
    return signalsJson({ ok: true, signal: await customerSignal(actor, signalId) });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
