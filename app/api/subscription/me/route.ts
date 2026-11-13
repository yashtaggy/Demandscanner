import { type NextRequest } from "next/server";
import { authErrorResponse } from "@/lib/auth/http";
import { toPublicAppUser } from "@/lib/auth/types";
import { getOwnSubscriptionState } from "@/lib/subscriptions/entitlements";
import { listPaymentsForUser } from "@/lib/subscriptions/repository";
import {
  subscriptionErrorResponse,
  subscriptionJson,
} from "@/lib/subscriptions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/subscription/me
 *
 * The authenticated user's own subscription state. Suspended and disabled
 * accounts are rejected by requireAppUser(); an account without a subscription
 * still gets a 200 so the UI can explain the state instead of rendering an
 * error. Another customer's data is unreachable: the user id comes from the
 * session, never from the query string.
 */
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await getOwnSubscriptionState(req.headers.get("cookie"));
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const payments = await listPaymentsForUser(session.user.userId);
    return subscriptionJson({
      ok: true,
      user: toPublicAppUser(session.user),
      subscriptionRequired: session.user.role === "CUSTOMER",
      entitled: session.subscription.entitled,
      today: session.subscription.today,
      current: session.subscription.current,
      history: session.subscription.history,
      payments: payments.map((payment) => ({
        paymentId: payment.paymentId,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        paymentReference: payment.paymentReference,
        paymentDate: payment.paymentDate,
        paymentStatus: payment.paymentStatus,
      })),
    });
  } catch (err) {
    return subscriptionErrorResponse(err);
  }
}
