import { type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { authErrorResponse } from "@/lib/auth/http";
import { getCustomer } from "@/lib/subscriptions/service";
import {
  subscriptionErrorResponse,
  subscriptionJson,
} from "@/lib/subscriptions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/** GET /api/admin/customers/:userId — account, subscription and payment history. */
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await requireAdmin(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  const { userId } = await ctx.params;
  try {
    return subscriptionJson({ ok: true, customer: await getCustomer(userId) });
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}
