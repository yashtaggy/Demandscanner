/**
 * Subscription domain types.
 *
 * Dates are inclusive Asia/Kolkata calendar dates stored as DATE. `status` is
 * the stored administrative state; `effectiveStatus` is what access control
 * uses at the current IST date (an ACTIVE row becomes EXPIRED after end_date).
 */

export const SUBSCRIPTION_PLAN_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type SubscriptionPlanStatus = (typeof SUBSCRIPTION_PLAN_STATUSES)[number];

export const STORED_SUBSCRIPTION_STATUSES = [
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "CANCELLED",
] as const;
export type StoredSubscriptionStatus =
  (typeof STORED_SUBSCRIPTION_STATUSES)[number];

export type EffectiveSubscriptionStatus =
  | "PENDING"
  | "ACTIVE"
  | "EXPIRED"
  | "CANCELLED"
  | "NONE";

export interface SubscriptionPlan {
  planId: string;
  name: string;
  description: string | null;
  durationDays: number;
  /** Decimal string, e.g. "1499.00". Never a float. */
  price: string;
  currency: string;
  status: SubscriptionPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  subscriptionId: string;
  userId: string;
  planId: string;
  planName: string;
  planPrice: string;
  planCurrency: string;
  /** YYYY-MM-DD in Asia/Kolkata, inclusive. */
  startDate: string;
  /** YYYY-MM-DD in Asia/Kolkata, inclusive. */
  endDate: string;
  status: StoredSubscriptionStatus;
  effectiveStatus: EffectiveSubscriptionStatus;
  daysRemaining: number | null;
  activatedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  renewedFromSubscriptionId: string | null;
  createdAt: string;
}

export interface PaymentRecord {
  paymentId: string;
  userId: string;
  subscriptionId: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string | null;
  paymentDate: string;
  paymentStatus: "RECORDED" | "VOID";
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface SubscriptionState {
  entitled: boolean;
  /** Current IST date reported by PostgreSQL. */
  today: string;
  current: Subscription | null;
  history: Subscription[];
}

export interface CustomerSubscriptionSummary {
  userId: string;
  email: string;
  displayName: string | null;
  accountStatus: "ACTIVE" | "SUSPENDED" | "DISABLED";
  role: "SUPER_ADMIN" | "ADMIN" | "CUSTOMER";
  subscription: Subscription | null;
  entitled: boolean;
  createdAt: string;
}

export interface CustomerSubscriptionDetail {
  customer: {
    userId: string;
    email: string;
    displayName: string | null;
    accountStatus: "ACTIVE" | "SUSPENDED" | "DISABLED";
    role: "SUPER_ADMIN" | "ADMIN" | "CUSTOMER";
    createdAt: string;
  };
  subscriptions: Subscription[];
  payments: PaymentRecord[];
}

export function isSubscriptionPlanStatus(
  value: unknown
): value is SubscriptionPlanStatus {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_PLAN_STATUSES as readonly string[]).includes(value)
  );
}
