import { type NextRequest } from "next/server";
import { requireCustomer } from "@/lib/auth/session";
import {
  authErrorResponse,
  getClientIp,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { signalsErrorResponse, signalsJson } from "@/lib/signals/http";
import { customerInbox } from "@/lib/signals/customer-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/signals?page=&pageSize=
 *
 * The authenticated customer's own inbox, newest first. The customer id comes
 * only from the verified session, so a query-string id is ignored.
 */
export async function GET(req: NextRequest) {
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

  try {
    const inbox = await customerInbox(actor, new URL(req.url).searchParams);
    return signalsJson({ ok: true, ...inbox });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
