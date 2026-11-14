import { type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import {
  authErrorResponse,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { signalsErrorResponse, signalsJson } from "@/lib/signals/http";
import { eligibleRecipients } from "@/lib/signals/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/signals/eligible-recipients?search=&limit=
 *
 * Super-admin recipient picker. Only ACTIVE CUSTOMER accounts are returned;
 * subscription state is irrelevant. The payload contains identity fields only.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireSuperAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const limit = await consumeRateLimit(
    `signals-recipients:${actor.userId}`,
    300,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(
      limit,
      "Too many recipient lookups. Try again later."
    );
  }

  try {
    const page = await eligibleRecipients(new URL(req.url).searchParams);
    return signalsJson({ ok: true, ...page });
  } catch (err) {
    return signalsErrorResponse(err);
  }
}
