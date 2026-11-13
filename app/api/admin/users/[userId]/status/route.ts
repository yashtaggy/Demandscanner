import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { ProvisioningError, setUserStatus } from "@/lib/auth/provisioning";
import { toPublicAppUser } from "@/lib/auth/types";
import {
  NO_STORE_HEADERS,
  authErrorResponse,
  isSameOriginRequest,
  jsonError,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/** PATCH /api/admin/users/:userId/status — ACTIVE | SUSPENDED | DISABLED */
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

  const { userId } = await ctx.params;
  if (!userId) {
    return jsonError(400, "MISSING_USER_ID", "A user id is required.");
  }

  const limit = await consumeRateLimit(`admin-mutation:${actor.userId}`, 60, 3600);
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many administrative changes. Try again later.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "INVALID_BODY", "A JSON body is required.");
  }

  try {
    const user = await setUserStatus(actor, userId, body.status, body.reason);
    return NextResponse.json(
      { ok: true, user: toPublicAppUser(user) },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    if (err instanceof ProvisioningError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error(
      "[admin/users/status] unexpected failure:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown"
    );
    return jsonError(500, "UPDATE_FAILED", "The user status could not be updated.");
  }
}
