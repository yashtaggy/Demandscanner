import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { provisionCustomer, ProvisioningError } from "@/lib/auth/provisioning";
import { toPublicAppUser } from "@/lib/auth/types";
import {
  NO_STORE_HEADERS,
  authErrorResponse,
  getClientIp,
  isSameOriginRequest,
  jsonError,
  rateLimitResponse,
} from "@/lib/auth/http";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { listCustomers } from "@/lib/subscriptions/service";
import { subscriptionErrorResponse } from "@/lib/subscriptions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/customers?search=
 *
 * Customer list with the latest subscription and the database-computed
 * entitlement flag. Backend-only gate: requires an administrator, not a
 * subscription.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const customers = await listCustomers(
      new URL(req.url).searchParams.get("search") ?? ""
    );
    return NextResponse.json(
      { ok: true, customers },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}

/**
 * POST /api/admin/customers
 *
 * Creates a Firebase account without a password, maps it to a new app_users row
 * with role CUSTOMER, and returns a one-time password reset link to the
 * initiating admin. The link is never logged or persisted.
 */
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
    `provision:actor:${actor.userId}:${getClientIp(req)}`,
    20,
    3600
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Too many provisioning attempts. Try again later.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "INVALID_BODY", "A JSON body is required.");
  }

  try {
    const result = await provisionCustomer(actor, {
      email: body.email,
      displayName: body.displayName,
    });

    return NextResponse.json(
      {
        ok: true,
        user: toPublicAppUser(result.user),
        resetLink: result.resetLink,
        notice:
          "Show this password-reset link to the customer once. It is not stored and cannot be retrieved again.",
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    if (err instanceof ProvisioningError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error(
      "[admin/customers] unexpected failure:",
      err instanceof Error ? err.message.slice(0, 200) : "unknown"
    );
    return jsonError(500, "PROVISIONING_FAILED", "The customer could not be provisioned.");
  }
}
