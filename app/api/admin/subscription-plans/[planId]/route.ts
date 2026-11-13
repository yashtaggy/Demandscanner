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
import { updatePlan } from "@/lib/subscriptions/service";
import {
  invalidBody,
  readJsonObject,
  subscriptionErrorResponse,
  subscriptionJson,
} from "@/lib/subscriptions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ planId: string }>;
}

/**
 * PATCH /api/admin/subscription-plans/:planId
 *
 * Plans are never deleted, because customer_subscriptions references them with
 * ON DELETE RESTRICT. Deactivation is the supported removal path.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  let actor;
  try {
    actor = await requireAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const { planId } = await ctx.params;
  const limit = await consumeRateLimit(
    `admin-plan:${actor.userId}:${getClientIp(req)}`,
    30,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many plan changes. Try again later.");
  }

  const body = await readJsonObject(req);
  if (!body) return invalidBody();

  try {
    return subscriptionJson({
      ok: true,
      plan: await updatePlan(actor, planId, body),
    });
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}
