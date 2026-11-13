/**
 * Subscription lifecycle rules with the database layer mocked.
 *
 * The repository is the only I/O boundary in lib/subscriptions/service.ts, so
 * mocking it lets these tests pin the business rules that Phase 4 mandates:
 * explicit activation, no shortening, renewal after expiry, payment isolation.
 */

import type { AppUser } from "@/lib/auth/types";
import type { AppUserWithIdentity } from "@/lib/auth/repository";
import type { Subscription, SubscriptionPlan } from "@/lib/subscriptions/types";

const TODAY = "2026-11-13";

jest.mock("@/lib/subscriptions/validation", () => {
  const actual = jest.requireActual("@/lib/subscriptions/validation");
  return { ...actual, todayInIst: () => "2026-11-13" };
});

jest.mock("@/lib/auth/repository", () => ({
  findAppUserById: jest.fn(),
}));

jest.mock("@/lib/subscriptions/repository", () => ({
  activateSubscriptionRow: jest.fn(),
  cancelSubscriptionRow: jest.fn(),
  extendSubscriptionRow: jest.fn(),
  findPlanById: jest.fn(),
  findSubscriptionById: jest.fn(),
  getCustomerDetail: jest.fn(),
  getSubscriptionState: jest.fn(),
  insertPayment: jest.fn(),
  insertPlan: jest.fn(),
  insertRenewal: jest.fn(),
  insertSubscription: jest.fn(),
  isUniqueViolation: jest.fn(),
  listCustomerSummaries: jest.fn(),
  listPlans: jest.fn(),
  listSubscriptionsForUser: jest.fn(),
  updatePlanRow: jest.fn(),
}));

import { findAppUserById } from "@/lib/auth/repository";
import * as repo from "@/lib/subscriptions/repository";
import { SubscriptionError } from "@/lib/subscriptions/errors";
import {
  activateSubscription,
  assignSubscription,
  cancelSubscription,
  createPlan,
  extendSubscription,
  recordPayment,
  renewSubscription,
  updatePlan,
} from "@/lib/subscriptions/service";

const mocked = repo as jest.Mocked<typeof repo>;

const ACTOR: AppUser = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "admin@example.com",
  displayName: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

const CUSTOMER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const OTHER_ID = "cccccccc-3333-4333-8333-333333333333";
const PLAN_ID = "dddddddd-4444-4444-8444-444444444444";
const SUB_ID = "eeeeeeee-5555-4555-8555-555555555555";

const CUSTOMER: AppUserWithIdentity = {
  userId: CUSTOMER_ID,
  email: "customer@example.com",
  displayName: "Customer",
  role: "CUSTOMER",
  status: "ACTIVE",
  firebaseUid: "firebase-customer",
};

function plan(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    planId: PLAN_ID,
    name: "Monthly",
    description: null,
    durationDays: 30,
    price: "499.00",
    currency: "INR",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    subscriptionId: SUB_ID,
    userId: CUSTOMER_ID,
    planId: PLAN_ID,
    planName: "Monthly",
    planPrice: "499.00",
    planCurrency: "INR",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    daysRemaining: 18,
    activatedAt: "2026-11-01T00:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
    renewedFromSubscriptionId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

async function expectSubscriptionError(
  promise: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, code });
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.isUniqueViolation.mockReturnValue(false);
  jest.mocked(findAppUserById).mockResolvedValue(CUSTOMER);
});

describe("createPlan", () => {
  it("normalizes name, price and currency", async () => {
    mocked.insertPlan.mockResolvedValue(plan());
    await createPlan(ACTOR, {
      name: "  Monthly  ",
      description: "  ",
      durationDays: "30",
      price: "499.9",
      currency: "inr",
      status: "ACTIVE",
    });

    expect(mocked.insertPlan).toHaveBeenCalledWith(ACTOR.userId, {
      name: "Monthly",
      description: null,
      durationDays: 30,
      price: "499.90",
      currency: "INR",
      status: "ACTIVE",
    });
  });

  it("rejects invalid fields before writing", async () => {
    await expectSubscriptionError(
      createPlan(ACTOR, { name: "  ", durationDays: 30, price: 0, currency: "INR", status: "ACTIVE" }),
      400,
      "INVALID_INPUT"
    );
    await expectSubscriptionError(
      createPlan(ACTOR, { name: "P", durationDays: 0, price: 0, currency: "INR", status: "ACTIVE" }),
      400,
      "INVALID_INPUT"
    );
    await expectSubscriptionError(
      createPlan(ACTOR, { name: "P", durationDays: 30, price: -1, currency: "INR", status: "ACTIVE" }),
      400,
      "INVALID_INPUT"
    );
    await expectSubscriptionError(
      createPlan(ACTOR, { name: "P", durationDays: 30, price: 0, currency: "RUPEE", status: "ACTIVE" }),
      400,
      "INVALID_INPUT"
    );
    await expectSubscriptionError(
      createPlan(ACTOR, { name: "P", durationDays: 30, price: 0, currency: "INR", status: "RETIRED" }),
      400,
      "INVALID_INPUT"
    );
    expect(mocked.insertPlan).not.toHaveBeenCalled();
  });

  it("maps duplicate names to a conflict", async () => {
    mocked.insertPlan.mockRejectedValue(new Error("duplicate key"));
    mocked.isUniqueViolation.mockReturnValue(true);
    await expectSubscriptionError(
      createPlan(ACTOR, { name: "Monthly", durationDays: 30, price: 0, currency: "INR", status: "ACTIVE" }),
      409,
      "PLAN_NAME_EXISTS"
    );
  });
});

describe("updatePlan", () => {
  it("keeps existing values when only one field changes", async () => {
    mocked.findPlanById.mockResolvedValue(plan());
    mocked.updatePlanRow.mockResolvedValue(plan({ status: "INACTIVE" }));

    await updatePlan(ACTOR, PLAN_ID, { status: "INACTIVE" });

    expect(mocked.updatePlanRow).toHaveBeenCalledWith(ACTOR.userId, PLAN_ID, {
      name: "Monthly",
      description: null,
      durationDays: 30,
      price: "499.00",
      currency: "INR",
      status: "INACTIVE",
    });
  });

  it("rejects unknown plans and invalid ids", async () => {
    await expectSubscriptionError(updatePlan(ACTOR, "nope", {}), 400, "INVALID_INPUT");
    mocked.findPlanById.mockResolvedValue(null);
    await expectSubscriptionError(updatePlan(ACTOR, PLAN_ID, {}), 404, "PLAN_NOT_FOUND");
  });
});

describe("assignSubscription", () => {
  it("creates a PENDING subscription for an active plan", async () => {
    mocked.findPlanById.mockResolvedValue(plan());
    mocked.insertSubscription.mockResolvedValue(subscription({ status: "PENDING", effectiveStatus: "PENDING" }));

    await assignSubscription(ACTOR, {
      userId: CUSTOMER_ID,
      planId: PLAN_ID,
      startDate: "2026-12-01",
    });

    expect(mocked.insertSubscription).toHaveBeenCalledWith(ACTOR.userId, {
      userId: CUSTOMER_ID,
      planId: PLAN_ID,
      startDate: "2026-12-01",
      status: "PENDING",
    });
  });

  it("defaults the start date to today in IST", async () => {
    mocked.findPlanById.mockResolvedValue(plan());
    mocked.insertSubscription.mockResolvedValue(subscription());
    await assignSubscription(ACTOR, { userId: CUSTOMER_ID, planId: PLAN_ID });
    expect(mocked.insertSubscription).toHaveBeenCalledWith(
      ACTOR.userId,
      expect.objectContaining({ startDate: TODAY })
    );
  });

  it("refuses admins, inactive plans and overlapping assignments", async () => {
    jest.mocked(findAppUserById).mockResolvedValue({ ...CUSTOMER, role: "ADMIN" });
    await expectSubscriptionError(
      assignSubscription(ACTOR, { userId: CUSTOMER_ID, planId: PLAN_ID }),
      404,
      "CUSTOMER_NOT_FOUND"
    );

    jest.mocked(findAppUserById).mockResolvedValue(CUSTOMER);
    mocked.findPlanById.mockResolvedValue(plan({ status: "INACTIVE" }));
    await expectSubscriptionError(
      assignSubscription(ACTOR, { userId: CUSTOMER_ID, planId: PLAN_ID }),
      409,
      "PLAN_INACTIVE"
    );

    mocked.findPlanById.mockResolvedValue(plan());
    mocked.insertSubscription.mockResolvedValue(null);
    await expectSubscriptionError(
      assignSubscription(ACTOR, { userId: CUSTOMER_ID, planId: PLAN_ID }),
      409,
      "SUBSCRIPTION_OVERLAP"
    );
  });

  it("rejects impossible start dates", async () => {
    await expectSubscriptionError(
      assignSubscription(ACTOR, { userId: CUSTOMER_ID, planId: PLAN_ID, startDate: "2026-02-30" }),
      400,
      "INVALID_INPUT"
    );
    expect(mocked.findPlanById).not.toHaveBeenCalled();
  });
});

describe("activateSubscription", () => {
  it("activates only a pending subscription", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription({ status: "PENDING", effectiveStatus: "PENDING" }));
    mocked.activateSubscriptionRow.mockResolvedValue(subscription());

    await activateSubscription(ACTOR, SUB_ID, CUSTOMER_ID);

    expect(mocked.activateSubscriptionRow).toHaveBeenCalledWith(ACTOR.userId, CUSTOMER_ID, SUB_ID);
  });

  it("hides subscriptions that belong to another customer", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription({ userId: OTHER_ID }));
    await expectSubscriptionError(activateSubscription(ACTOR, SUB_ID, CUSTOMER_ID), 404, "SUBSCRIPTION_NOT_FOUND");
  });

  it("rejects already active subscriptions and ended ones", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    await expectSubscriptionError(activateSubscription(ACTOR, SUB_ID), 409, "INVALID_STATE");

    mocked.findSubscriptionById.mockResolvedValue(
      subscription({ status: "PENDING", effectiveStatus: "PENDING", endDate: "2026-11-01" })
    );
    mocked.activateSubscriptionRow.mockResolvedValue(null);
    await expectSubscriptionError(activateSubscription(ACTOR, SUB_ID), 409, "SUBSCRIPTION_ENDED");
  });
});

describe("extendSubscription", () => {
  it("adds days through the repository without shortening", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    mocked.extendSubscriptionRow.mockResolvedValue(subscription({ endDate: "2026-12-30" }));

    await extendSubscription(ACTOR, SUB_ID, "30", CUSTOMER_ID);

    expect(mocked.extendSubscriptionRow).toHaveBeenCalledWith(ACTOR.userId, CUSTOMER_ID, SUB_ID, 30);
  });

  it("rejects bad day counts, wrong owners and ended subscriptions", async () => {
    await expectSubscriptionError(extendSubscription(ACTOR, SUB_ID, 0), 400, "INVALID_INPUT");
    await expectSubscriptionError(extendSubscription(ACTOR, SUB_ID, 3661), 400, "INVALID_INPUT");

    mocked.findSubscriptionById.mockResolvedValue(subscription({ userId: OTHER_ID }));
    await expectSubscriptionError(extendSubscription(ACTOR, SUB_ID, 30, CUSTOMER_ID), 404, "SUBSCRIPTION_NOT_FOUND");

    mocked.findSubscriptionById.mockResolvedValue(subscription({ status: "EXPIRED" }));
    await expectSubscriptionError(extendSubscription(ACTOR, SUB_ID, 30), 409, "INVALID_STATE");
  });
});

describe("cancelSubscription", () => {
  it("requires an audited reason", async () => {
    await expectSubscriptionError(cancelSubscription(ACTOR, SUB_ID, "  "), 400, "INVALID_INPUT");
    await expectSubscriptionError(cancelSubscription(ACTOR, SUB_ID, "no"), 400, "INVALID_INPUT");
    expect(mocked.findSubscriptionById).not.toHaveBeenCalled();
  });

  it("cancels an existing subscription with its reason", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    mocked.cancelSubscriptionRow.mockResolvedValue(
      subscription({ status: "CANCELLED", cancellationReason: "Customer request" })
    );

    await cancelSubscription(ACTOR, SUB_ID, "Customer request", CUSTOMER_ID);

    expect(mocked.cancelSubscriptionRow).toHaveBeenCalledWith(
      ACTOR.userId,
      CUSTOMER_ID,
      SUB_ID,
      "Customer request"
    );
  });

  it("rejects double cancellation and wrong owners", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription({ status: "CANCELLED" }));
    await expectSubscriptionError(cancelSubscription(ACTOR, SUB_ID, "Duplicate"), 409, "INVALID_STATE");

    mocked.findSubscriptionById.mockResolvedValue(subscription({ userId: OTHER_ID }));
    await expectSubscriptionError(
      cancelSubscription(ACTOR, SUB_ID, "Wrong owner", CUSTOMER_ID),
      404,
      "SUBSCRIPTION_NOT_FOUND"
    );
  });
});

describe("renewSubscription", () => {
  it("starts a still-valid renewal after the current end date", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    mocked.findPlanById.mockResolvedValue(plan());
    mocked.insertRenewal.mockResolvedValue(subscription({ status: "PENDING", effectiveStatus: "PENDING" }));

    await renewSubscription(ACTOR, { subscriptionId: SUB_ID, expectedUserId: CUSTOMER_ID });

    expect(mocked.insertRenewal).toHaveBeenCalledWith(ACTOR.userId, {
      userId: CUSTOMER_ID,
      baseSubscriptionId: SUB_ID,
      planId: PLAN_ID,
      startDate: null,
    });
  });

  it("requires an explicit start date once the subscription has expired", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription({ endDate: "2026-10-31" }));
    mocked.findPlanById.mockResolvedValue(plan());

    await expectSubscriptionError(
      renewSubscription(ACTOR, { subscriptionId: SUB_ID }),
      400,
      "RENEWAL_START_REQUIRED"
    );

    await renewSubscription(ACTOR, { subscriptionId: SUB_ID, startDate: "2026-12-01" });
    expect(mocked.insertRenewal).toHaveBeenCalledWith(
      ACTOR.userId,
      expect.objectContaining({ startDate: "2026-12-01" })
    );
  });

  it("refuses renewals inside the current period", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    mocked.findPlanById.mockResolvedValue(plan());

    await expectSubscriptionError(
      renewSubscription(ACTOR, { subscriptionId: SUB_ID, startDate: "2026-11-30" }),
      409,
      "RENEWAL_OVERLAP"
    );
  });

  it("refuses plan changes rather than inventing proration", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    await expectSubscriptionError(
      renewSubscription(ACTOR, {
        subscriptionId: SUB_ID,
        planId: "ffffffff-6666-4666-8666-666666666666",
      }),
      400,
      "PLAN_CHANGE_UNSUPPORTED"
    );
  });

  it("rejects renewing pending or cancelled subscriptions", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription({ status: "PENDING" }));
    await expectSubscriptionError(renewSubscription(ACTOR, { subscriptionId: SUB_ID }), 409, "INVALID_STATE");

    mocked.findSubscriptionById.mockResolvedValue(subscription({ status: "CANCELLED" }));
    await expectSubscriptionError(renewSubscription(ACTOR, { subscriptionId: SUB_ID }), 409, "INVALID_STATE");
  });

  it("hides subscriptions belonging to another customer", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription({ userId: OTHER_ID }));
    await expectSubscriptionError(
      renewSubscription(ACTOR, { subscriptionId: SUB_ID, expectedUserId: CUSTOMER_ID }),
      404,
      "SUBSCRIPTION_NOT_FOUND"
    );
  });
});

describe("recordPayment", () => {
  const base = {
    subscriptionId: SUB_ID,
    amount: "499",
    currency: "INR",
    paymentMethod: "UPI",
    paymentDate: "2026-11-13",
  };

  it("records a manual payment for the subscription owner", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    mocked.insertPayment.mockResolvedValue({ paymentId: "pay" } as never);

    await recordPayment(ACTOR, { ...base, notes: " First instalment " });

    expect(mocked.insertPayment).toHaveBeenCalledWith(ACTOR.userId, {
      userId: CUSTOMER_ID,
      subscriptionId: SUB_ID,
      amount: "499.00",
      currency: "INR",
      paymentMethod: "UPI",
      paymentReference: null,
      paymentDate: "2026-11-13",
      notes: "First instalment",
    });
  });

  it("never changes subscription state", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    mocked.insertPayment.mockResolvedValue({ paymentId: "pay" } as never);
    await recordPayment(ACTOR, base);
    expect(mocked.activateSubscriptionRow).not.toHaveBeenCalled();
    expect(mocked.insertSubscription).not.toHaveBeenCalled();
  });

  it("rejects amount, currency, method and date violations", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());

    await expectSubscriptionError(recordPayment(ACTOR, { ...base, amount: "0" }), 400, "INVALID_INPUT");
    await expectSubscriptionError(recordPayment(ACTOR, { ...base, amount: "-5" }), 400, "INVALID_INPUT");
    await expectSubscriptionError(recordPayment(ACTOR, { ...base, currency: "USD" }), 400, "PAYMENT_CURRENCY_MISMATCH");
    await expectSubscriptionError(recordPayment(ACTOR, { ...base, paymentMethod: "  " }), 400, "INVALID_INPUT");
    await expectSubscriptionError(
      recordPayment(ACTOR, { ...base, paymentDate: "2026-11-14" }),
      400,
      "PAYMENT_DATE_FUTURE"
    );
    await expectSubscriptionError(
      recordPayment(ACTOR, { ...base, paymentDate: "2026-02-30" }),
      400,
      "INVALID_INPUT"
    );
    expect(mocked.insertPayment).not.toHaveBeenCalled();
  });

  it("rejects a payment targeted at another customer's subscription", async () => {
    mocked.findSubscriptionById.mockResolvedValue(subscription());
    await expectSubscriptionError(
      recordPayment(ACTOR, { ...base, userId: OTHER_ID }),
      400,
      "PAYMENT_SUBSCRIPTION_MISMATCH"
    );
  });

  it("rejects unknown subscriptions", async () => {
    mocked.findSubscriptionById.mockResolvedValue(null);
    await expectSubscriptionError(recordPayment(ACTOR, base), 404, "SUBSCRIPTION_NOT_FOUND");
    await expectSubscriptionError(
      recordPayment(ACTOR, { ...base, subscriptionId: "not-a-uuid" }),
      404,
      "SUBSCRIPTION_NOT_FOUND"
    );
  });
});

describe("SubscriptionError", () => {
  it("is the type every failure uses", async () => {
    mocked.findPlanById.mockResolvedValue(null);
    await expect(updatePlan(ACTOR, PLAN_ID, {})).rejects.toBeInstanceOf(SubscriptionError);
  });
});
