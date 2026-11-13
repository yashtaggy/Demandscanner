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
import { createPlan, listPlanCatalog } from "@/lib/subscriptions/service";
import {
  invalidBody,
  readJsonObject,
  subscriptionErrorResponse,
  subscriptionJson,
} from "@/lib/subscriptions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/subscription-plans — active and inactive plans. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    return subscriptionJson({ ok: true, plans: await listPlanCatalog() });
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}

/** POST /api/admin/subscription-plans — creates a plan. */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return jsonError(403, "INVALID_ORIGIN", "Request origin is not allowed.");
  }

  let actor;
  try {
    actor = await requireAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

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
    return subscriptionJson(
      { ok: true, plan: await createPlan(actor, body) },
      201
    );
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}
