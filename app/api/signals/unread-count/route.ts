import { type NextRequest } from "next/server";
import { requireCustomer } from "@/lib/auth/session";
import {
  authErrorResponse,
  getClientIp,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { signalsErrorResponse, signalsJson } from "@/lib/signals/http";
import { customerUnreadCount } from "@/lib/signals/customer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/signals/unread-count
 *
 * Unread badge for the authenticated customer. The static segment wins over
 * `/api/signals/[signalId]`, so this route is never treated as a signal id.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireCustomer(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await consumeRateLimit(
    `signals-customer-unread:${actor.userId}:${getClientIp(req)}`,
    600,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many unread-count lookups. Try again later.");
  }

  try {
    return signalsJson({ ok: true, unreadCount: await customerUnreadCount(actor) });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
