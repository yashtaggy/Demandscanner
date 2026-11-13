import { type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import {
  authErrorResponse,
  getClientIp,
  isSameOriginRequest,
  jsonError,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { recordPayment } from "@/lib/subscriptions/service";
import {
  invalidBody,
  readJsonObject,
  subscriptionErrorResponse,
  subscriptionJson,
} from "@/lib/subscriptions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * POST /api/admin/customers/:userId/payments
 *
 * Records a manual payment. It never activates, extends or renews a
 * subscription; those remain separate audited actions. Payments are immutable
 * after recording: there is deliberately no PATCH or DELETE route.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  let actor;
  try {
    actor = await requireAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const { userId } = await ctx.params;
  const limit = await consumeRateLimit(
    `admin-payment:${actor.userId}:${getClientIp(req)}`,
    60,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many payment entries. Try again later.");
  }

  const body = await readJsonObject(req);
  if (!body) return invalidBody();

  try {
    return subscriptionJson(
      { ok: true, payment: await recordPayment(actor, { ...body, userId }) },
      201
    );
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}
