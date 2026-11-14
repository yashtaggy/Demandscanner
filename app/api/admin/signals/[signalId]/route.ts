import { type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import { authErrorResponse, rateLimitResponse } from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { signalsErrorResponse, signalsJson } from "@/lib/signals/http";
import { signalDetail } from "@/lib/signals/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

/** GET /api/admin/signals/:signalId — publication detail and recipients. */
export async function GET(req: NextRequest, ctx: RouteContext) {
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

  const { signalId } = await ctx.params;

  try {
    return signalsJson({ ok: true, signal: await signalDetail(signalId) });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
