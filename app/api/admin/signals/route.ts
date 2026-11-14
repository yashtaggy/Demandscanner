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
import {
  readSignalsJsonBody,
  signalsErrorResponse,
  signalsJson,
} from "@/lib/signals/http";
import { publishSignal, signalHistory } from "@/lib/signals/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/signals?page=&pageSize= — paginated publication history. */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireSuperAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await consumeRateLimit(`signals-read:${actor.userId}`, 300, 3600);
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many signal lookups. Try again later.");
  }

  try {
    const page = await signalHistory(new URL(req.url).searchParams);
    return signalsJson({ ok: true, ...page });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}

/**
 * POST /api/admin/signals
 *
 * Publishes a signal to explicitly selected customers or to every eligible
 * customer resolved at publication time. An optional idempotency key makes a
 * repeated request return the original publication.
 */
export async function POST(req: NextRequest) {
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
    `signals-publish:${actor.userId}:${getClientIp(req)}`,
    30,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many publications. Try again later.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readSignalsJsonBody(req);
  } catch (err) {
    return signalsErrorResponse(err);
  }

  try {
    const signal = await publishSignal(actor, body);
    return signalsJson({ ok: true, signal }, signal.reused ? 200 : 201);
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
