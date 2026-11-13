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
import { assignSubscription } from "@/lib/subscriptions/service";
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
 * POST /api/admin/customers/:userId/subscriptions
 *
 * Creates a PENDING subscription. Activation is a separate explicit action, so
 * assigning never grants access by itself.
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
    return subscriptionJson(
      {
        ok: true,
        subscription: await assignSubscription(actor, { ...body, userId }),
      },
      201
    );
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}
