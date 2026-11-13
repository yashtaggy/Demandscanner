/**
 * Subscription lifecycle. SERVER ONLY.
 *
 * Business rules:
 *   * Assigning creates a PENDING subscription; activation is a separate,
 *     explicit administrative action.
 *   * Assignments and renewals use the plan's inclusive duration_days:
 *     end_date = start_date + duration_days - 1.
 *   * A renewal starts after the current end date. Renewing an expired
 *     subscription requires an explicit start date.
 *   * Plan changes, proration, refunds and trial periods are not implemented.
 *   * Recording a payment never changes subscription state.
 */

import { findAppUserById } from "@/lib/auth/repository";
import type { AppUser } from "@/lib/auth/types";
import { SubscriptionError } from "./errors";
import {
  activateSubscriptionRow,
  cancelSubscriptionRow,
  extendSubscriptionRow,
  findPlanById,
  findSubscriptionById,
  getCustomerDetail,
  getSubscriptionState,
  insertPayment,
  insertPlan,
  insertRenewal,
  insertSubscription,
  isUniqueViolation,
  listCustomerSummaries,
  listPlans,
  listSubscriptionsForUser,
  updatePlanRow,
} from "./repository";
import type {
  CustomerSubscriptionDetail,
  CustomerSubscriptionSummary,
  Subscription,
  SubscriptionPlan,
  SubscriptionState,
} from "./types";
import { isSubscriptionPlanStatus } from "./types";
import {
  isValidUuid,
  normalizeCurrency,
  normalizeOptionalText,
  parseDateOnly,
  parseMoney,
  parsePositiveInteger,
  todayInIst,
} from "./validation";

function invalid(message: string): never {
  throw new SubscriptionError(400, "INVALID_INPUT", message);
}

function requiredName(raw: unknown): string {
  const result = normalizeOptionalText(raw, 120);
  if (!result.ok || !result.value) invalid("Plan name is required.");
  return result.value;
}

function planFields(input: {
  name?: unknown;
  description?: unknown;
  durationDays?: unknown;
  price?: unknown;
  currency?: unknown;
  status?: unknown;
}, current?: SubscriptionPlan): {
  name: string;
  description: string | null;
  durationDays: number;
  price: string;
  currency: string;
  status: SubscriptionPlan["status"];
} {
  const name =
    input.name === undefined && current ? current.name : requiredName(input.name);

  let description: string | null;
  if (input.description === undefined) {
    description = current?.description ?? null;
  } else {
    const result = normalizeOptionalText(input.description, 2000);
    if (!result.ok) invalid("Plan description is too long.");
    description = result.value;
  }

  const durationDays =
    input.durationDays === undefined && current
      ? current.durationDays
      : parsePositiveInteger(input.durationDays, 1, 3660);
  if (durationDays === null || durationDays === undefined) {
    invalid("Duration must be a whole number of days between 1 and 3660.");
  }

  let price: string;
  if (input.price === undefined && current) {
    price = current.price;
  } else {
    const parsed = parseMoney(input.price);
    if (!parsed) invalid("Price must be a non-negative amount with up to 2 decimals.");
    price = parsed.amount;
  }

  const currency =
    input.currency === undefined && current
      ? current.currency
      : normalizeCurrency(input.currency);
  if (!currency) invalid("Currency must be a 3-letter ISO code such as INR.");

  const status =
    input.status === undefined && current
      ? current.status
      : isSubscriptionPlanStatus(input.status)
        ? input.status
        : null;
  if (!status) invalid("Plan status must be ACTIVE or INACTIVE.");

  return { name, description, durationDays, price, currency, status };
}

export async function listPlanCatalog(): Promise<SubscriptionPlan[]> {
  return listPlans();
}

export async function createPlan(
  actor: AppUser,
  input: Record<string, unknown>
): Promise<SubscriptionPlan> {
  const fields = planFields(input);
  try {
    return await insertPlan(actor.userId, fields);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SubscriptionError(
        409,
        "PLAN_NAME_EXISTS",
        "A plan with this name already exists."
      );
    }
    throw error;
  }
}

export async function updatePlan(
  actor: AppUser,
  planId: string,
  input: Record<string, unknown>
): Promise<SubscriptionPlan> {
  if (!isValidUuid(planId)) invalid("Plan id is invalid.");
  const current = await findPlanById(planId);
  if (!current) {
    throw new SubscriptionError(404, "PLAN_NOT_FOUND", "Plan not found.");
  }

  const fields = planFields(input, current);

  try {
    const updated = await updatePlanRow(actor.userId, planId, fields);
    if (!updated) {
      throw new SubscriptionError(404, "PLAN_NOT_FOUND", "Plan not found.");
    }
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SubscriptionError(
        409,
        "PLAN_NAME_EXISTS",
        "A plan with this name already exists."
      );
    }
    throw error;
  }
}

async function requireCustomer(userId: string): Promise<AppUser> {
  if (!isValidUuid(userId)) {
    throw new SubscriptionError(404, "CUSTOMER_NOT_FOUND", "Customer not found.");
  }
  const customer = await findAppUserById(userId);
  if (!customer || customer.role !== "CUSTOMER") {
    throw new SubscriptionError(404, "CUSTOMER_NOT_FOUND", "Customer not found.");
  }
  return customer;
}

async function requirePlan(planId: string): Promise<SubscriptionPlan> {
  if (!isValidUuid(planId)) {
    throw new SubscriptionError(404, "PLAN_NOT_FOUND", "Plan not found.");
  }
  const plan = await findPlanById(planId);
  if (!plan) {
    throw new SubscriptionError(404, "PLAN_NOT_FOUND", "Plan not found.");
  }
  if (plan.status !== "ACTIVE") {
    throw new SubscriptionError(
      409,
      "PLAN_INACTIVE",
      "This plan is inactive and cannot be assigned."
    );
  }
  return plan;
}

export async function assignSubscription(
  actor: AppUser,
  input: Record<string, unknown>
): Promise<Subscription> {
  const userId = input.userId;
  const planId = input.planId;
  if (!isValidUuid(userId)) invalid("A valid customer id is required.");
  if (!isValidUuid(planId)) invalid("A valid plan id is required.");

  const startDate =
    input.startDate === undefined || input.startDate === null
      ? todayInIst()
      : parseDateOnly(input.startDate);
  if (!startDate) invalid("Start date must be a real YYYY-MM-DD date.");

  await requireCustomer(userId);
  await requirePlan(planId);

  const created = await insertSubscription(actor.userId, {
    userId,
    planId,
    startDate,
    status: "PENDING",
  });
  if (!created) {
    throw new SubscriptionError(
      409,
      "SUBSCRIPTION_OVERLAP",
      "This customer already has a subscription covering those dates."
    );
  }
  return created;
}

export async function activateSubscription(
  actor: AppUser,
  subscriptionId: string,
  expectedUserId?: string
): Promise<Subscription> {
  if (!isValidUuid(subscriptionId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  const target = await findSubscriptionById(subscriptionId);
  if (!target || (expectedUserId && target.userId !== expectedUserId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  if (target.status !== "PENDING") {
    throw new SubscriptionError(
      409,
      "INVALID_STATE",
      "Only a pending subscription can be activated."
    );
  }

  const updated = await activateSubscriptionRow(
    actor.userId,
    target.userId,
    subscriptionId
  );
  if (updated) return updated;

  if (target.endDate < todayInIst()) {
    throw new SubscriptionError(
      409,
      "SUBSCRIPTION_ENDED",
      "This subscription has already ended. Assign or renew a current one."
    );
  }
  throw new SubscriptionError(
    409,
    "SUBSCRIPTION_OVERLAP",
    "Another subscription covers these dates."
  );
}

export async function extendSubscription(
  actor: AppUser,
  subscriptionId: string,
  rawAdditionalDays: unknown,
  expectedUserId?: string
): Promise<Subscription> {
  if (!isValidUuid(subscriptionId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  const days = parsePositiveInteger(rawAdditionalDays, 1, 3660);
  if (days === null) invalid("Extension must be between 1 and 3660 days.");

  const target = await findSubscriptionById(subscriptionId);
  if (!target || (expectedUserId && target.userId !== expectedUserId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  if (target.status !== "PENDING" && target.status !== "ACTIVE") {
    throw new SubscriptionError(
      409,
      "INVALID_STATE",
      "Only a pending or active subscription can be extended."
    );
  }

  const updated = await extendSubscriptionRow(
    actor.userId,
    target.userId,
    subscriptionId,
    days
  );
  if (!updated) {
    throw new SubscriptionError(
      409,
      "SUBSCRIPTION_OVERLAP",
      "The new end date overlaps another subscription."
    );
  }
  return updated;
}

export async function cancelSubscription(
  actor: AppUser,
  subscriptionId: string,
  rawReason: unknown,
  expectedUserId?: string
): Promise<Subscription> {
  if (!isValidUuid(subscriptionId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  const reasonResult = normalizeOptionalText(rawReason, 500);
  if (!reasonResult.ok || !reasonResult.value || reasonResult.value.length < 3) {
    invalid("A cancellation reason of at least 3 characters is required.");
  }

  const target = await findSubscriptionById(subscriptionId);
  if (!target || (expectedUserId && target.userId !== expectedUserId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  if (target.status === "CANCELLED") {
    throw new SubscriptionError(
      409,
      "INVALID_STATE",
      "This subscription is already cancelled."
    );
  }

  const updated = await cancelSubscriptionRow(
    actor.userId,
    target.userId,
    subscriptionId,
    reasonResult.value
  );
  if (!updated) {
    throw new SubscriptionError(
      409,
      "INVALID_STATE",
      "The subscription could not be cancelled in its current state."
    );
  }
  return updated;
}

export async function renewSubscription(
  actor: AppUser,
  input: Record<string, unknown>
): Promise<Subscription> {
  const subscriptionId = input.subscriptionId;
  if (!isValidUuid(subscriptionId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }

  const base = await findSubscriptionById(subscriptionId);
  if (
    !base ||
    (input.expectedUserId !== undefined && base.userId !== input.expectedUserId)
  ) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  if (base.status === "CANCELLED") {
    throw new SubscriptionError(
      409,
      "INVALID_STATE",
      "A cancelled subscription cannot be renewed."
    );
  }
  if (base.status === "PENDING") {
    throw new SubscriptionError(
      409,
      "INVALID_STATE",
      "Activate or cancel the pending subscription before renewing."
    );
  }

  if (input.planId !== undefined && input.planId !== base.planId) {
    if (!isValidUuid(input.planId)) invalid("A valid plan id is required.");
    throw new SubscriptionError(
      400,
      "PLAN_CHANGE_UNSUPPORTED",
      "Plan changes are not supported. Cancel and assign a new plan instead."
    );
  }
  await requirePlan(base.planId);

  const today = todayInIst();
  const baseStillValid = base.status === "ACTIVE" && base.endDate >= today;

  let startDate: string | null = null;
  if (input.startDate !== undefined && input.startDate !== null) {
    startDate = parseDateOnly(input.startDate);
    if (!startDate) invalid("Start date must be a real YYYY-MM-DD date.");
    if (startDate <= base.endDate) {
      throw new SubscriptionError(
        409,
        "RENEWAL_OVERLAP",
        "A renewal must start after the current subscription ends."
      );
    }
  } else if (!baseStillValid) {
    throw new SubscriptionError(
      400,
      "RENEWAL_START_REQUIRED",
      "Choose a start date for renewing an expired subscription."
    );
  }

  const created = await insertRenewal(actor.userId, {
    userId: base.userId,
    baseSubscriptionId: base.subscriptionId,
    planId: base.planId,
    startDate,
  });
  if (!created) {
    throw new SubscriptionError(
      409,
      "SUBSCRIPTION_OVERLAP",
      "The renewal overlaps another subscription."
    );
  }
  return created;
}

export async function recordPayment(
  actor: AppUser,
  input: Record<string, unknown>
): Promise<ReturnType<typeof insertPayment>> {
  const subscriptionId = input.subscriptionId;
  if (!isValidUuid(subscriptionId)) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  const subscription = await findSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new SubscriptionError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found."
    );
  }
  if (input.userId !== undefined && input.userId !== subscription.userId) {
    throw new SubscriptionError(
      400,
      "PAYMENT_SUBSCRIPTION_MISMATCH",
      "The subscription does not belong to that customer."
    );
  }
  await requireCustomer(subscription.userId);

  const amount = parseMoney(input.amount);
  if (!amount || amount.value <= 0) {
    invalid("Payment amount must be greater than zero.");
  }

  const currency = normalizeCurrency(input.currency);
  if (!currency) invalid("Payment currency must be a 3-letter ISO code.");
  if (currency !== subscription.planCurrency) {
    throw new SubscriptionError(
      400,
      "PAYMENT_CURRENCY_MISMATCH",
      "Payment currency must match the subscription plan currency."
    );
  }

  const method = normalizeOptionalText(input.paymentMethod, 40);
  if (!method.ok || !method.value) {
    invalid("A payment method is required.");
  }

  const reference = normalizeOptionalText(input.paymentReference, 120);
  if (!reference.ok) invalid("Payment reference is too long.");

  const notes = normalizeOptionalText(input.notes, 1000);
  if (!notes.ok) invalid("Payment notes are too long.");

  const paymentDate =
    input.paymentDate === undefined || input.paymentDate === null
      ? todayInIst()
      : parseDateOnly(input.paymentDate);
  if (!paymentDate) invalid("Payment date must be a real YYYY-MM-DD date.");
  if (paymentDate > todayInIst()) {
    throw new SubscriptionError(
      400,
      "PAYMENT_DATE_FUTURE",
      "Payment date cannot be in the future."
    );
  }

  return insertPayment(actor.userId, {
    userId: subscription.userId,
    subscriptionId: subscription.subscriptionId,
    amount: amount.amount,
    currency,
    paymentMethod: method.value,
    paymentReference: reference.value,
    paymentDate,
    notes: notes.value,
  });
}

export async function listCustomers(
  rawSearch: unknown
): Promise<CustomerSubscriptionSummary[]> {
  const search =
    typeof rawSearch === "string" ? rawSearch.trim().slice(0, 120) : "";
  return listCustomerSummaries(search);
}

export async function getCustomer(
  userId: string
): Promise<CustomerSubscriptionDetail> {
  if (!isValidUuid(userId)) {
    throw new SubscriptionError(404, "CUSTOMER_NOT_FOUND", "Customer not found.");
  }
  const detail = await getCustomerDetail(userId);
  if (!detail) {
    throw new SubscriptionError(404, "CUSTOMER_NOT_FOUND", "Customer not found.");
  }
  return detail;
}

export async function customerSubscriptionState(
  userId: string
): Promise<SubscriptionState> {
  return getSubscriptionState(userId);
}

export async function customerSubscriptions(
  userId: string
): Promise<Subscription[]> {
  return listSubscriptionsForUser(userId);
}
