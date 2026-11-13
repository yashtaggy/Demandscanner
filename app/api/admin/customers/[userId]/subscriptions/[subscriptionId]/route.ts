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
import {
  activateSubscription,
  cancelSubscription,
  extendSubscription,
  renewSubscription,
} from "@/lib/subscriptions/service";
import {
  invalidBody,
  readJsonObject,
  subscriptionErrorResponse,
  subscriptionJson,
} from "@/lib/subscriptions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ userId: string; subscriptionId: string }>;
}

/**
 * PATCH /api/admin/customers/:userId/subscriptions/:subscriptionId
 *
 * Explicit lifecycle actions. Each one is audited by the repository in the same
 * statement as the change. The path userId is re-verified against the stored
 * subscription, so one customer's id cannot be used to mutate another's.
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

  const { userId, subscriptionId } = await ctx.params;
  const limit = await consumeRateLimit(
    `admin-subscription:${actor.userId}:${getClientIp(req)}`,
    60,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(
      limit,
      "Too many subscription changes. Try again later."
    );
  }

  const body = await readJsonObject(req);
  if (!body) return invalidBody();

  try {
    switch (body.action) {
      case "ACTIVATE":
        return subscriptionJson({
          ok: true,
          subscription: await activateSubscription(
            actor,
            subscriptionId,
            userId
          ),
        });
      case "EXTEND":
        return subscriptionJson({
          ok: true,
          subscription: await extendSubscription(
            actor,
            subscriptionId,
            body.additionalDays,
            userId
          ),
        });
      case "CANCEL":
        return subscriptionJson({
          ok: true,
          subscription: await cancelSubscription(
            actor,
            subscriptionId,
            body.reason,
            userId
          ),
        });
      case "RENEW":
        return subscriptionJson(
          {
            ok: true,
            subscription: await renewSubscription(actor, {
              ...body,
              subscriptionId,
              expectedUserId: userId,
            }),
          },
          201
        );
      default:
        return jsonError(
          400,
          "INVALID_ACTION",
          "Action must be ACTIVATE, EXTEND, CANCEL or RENEW."
        );
    }
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}
