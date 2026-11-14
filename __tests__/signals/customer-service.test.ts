/**
 * Customer Signals service rules: session identity, pagination validation,
 * ownership 404s and the read-state payload contract.
 *
 * The repository is mocked; these tests pin what is passed to the database.
 */

jest.mock("@/lib/signals/repository", () => ({
  countCustomerUnread: jest.fn(),
  findCustomerSignal: jest.fn(),
  listCustomerInbox: jest.fn(),
  setCustomerReadState: jest.fn(),
}));

import type { AppUser } from "@/lib/auth/types";
import * as repository from "@/lib/signals/repository";
import {
  customerInbox,
  customerSignal,
  customerUnreadCount,
  updateCustomerReadState,
} from "@/lib/signals/customer-service";
import { SignalsError } from "@/lib/signals/errors";

const mockedRepo = repository as jest.Mocked<typeof repository>;

const CUSTOMER: AppUser = {
  userId: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "customer@example.com",
  displayName: "Customer",
  status: "ACTIVE",
  role: "CUSTOMER",
};

const OTHER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const SIGNAL_ID = "dddddddd-4444-4444-8444-444444444444";

const INBOX = {
  signals: [],
  page: 1,
  pageSize: 20,
  total: 0,
  unreadCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("customerInbox", () => {
  it("uses defaults and the session user id", async () => {
    mockedRepo.listCustomerInbox.mockResolvedValue(INBOX);
    await customerInbox(CUSTOMER, new URLSearchParams());
    expect(mockedRepo.listCustomerInbox).toHaveBeenCalledWith(CUSTOMER.userId, 1, 20);
  });

  it("passes a bounded page and page size", async () => {
    mockedRepo.listCustomerInbox.mockResolvedValue(INBOX);
    await customerInbox(CUSTOMER, new URLSearchParams("page=3&pageSize=50"));
    expect(mockedRepo.listCustomerInbox).toHaveBeenCalledWith(CUSTOMER.userId, 3, 50);
  });

  it("ignores a caller-supplied user id", async () => {
    mockedRepo.listCustomerInbox.mockResolvedValue(INBOX);
    await customerInbox(CUSTOMER, new URLSearchParams(`userId=${OTHER_ID}`));
    expect(mockedRepo.listCustomerInbox).toHaveBeenCalledWith(CUSTOMER.userId, 1, 20);
  });

  it.each(["page=0", "page=abc", "pageSize=0", "pageSize=101"])(
    "rejects invalid pagination %s before querying",
    async (query) => {
      await expect(
        customerInbox(CUSTOMER, new URLSearchParams(query))
      ).rejects.toMatchObject({ status: 400, code: "INVALID_PAGINATION" });
      expect(mockedRepo.listCustomerInbox).not.toHaveBeenCalled();
    }
  );
});

describe("customerSignal", () => {
  it("rejects a malformed id as not found without querying", async () => {
    for (const id of ["not-a-uuid", "", "dddddddd-4444-4444-8444"]) {
      await expect(customerSignal(CUSTOMER, id)).rejects.toMatchObject({
        status: 404,
        code: "SIGNAL_NOT_FOUND",
      });
    }
    expect(mockedRepo.findCustomerSignal).not.toHaveBeenCalled();
  });

  it("returns 404 when no row is assigned to this customer", async () => {
    mockedRepo.findCustomerSignal.mockResolvedValue(null);
    await expect(customerSignal(CUSTOMER, SIGNAL_ID)).rejects.toBeInstanceOf(
      SignalsError
    );
    expect(mockedRepo.findCustomerSignal).toHaveBeenCalledWith(
      CUSTOMER.userId,
      SIGNAL_ID
    );
  });

  it("returns the stored message unmodified", async () => {
    const detail = {
      signalId: SIGNAL_ID,
      message: "  first\nsecond 🔥  ",
      publishedAt: "2026-11-14T10:00:00.000Z",
      readAt: null,
      isRead: false,
    };
    mockedRepo.findCustomerSignal.mockResolvedValue(detail);
    await expect(customerSignal(CUSTOMER, SIGNAL_ID)).resolves.toEqual(detail);
  });
});

describe("updateCustomerReadState", () => {
  it("rejects a malformed id as not found without querying", async () => {
    await expect(
      updateCustomerReadState(CUSTOMER, "not-a-uuid", { isRead: true })
    ).rejects.toMatchObject({ status: 404, code: "SIGNAL_NOT_FOUND" });
    expect(mockedRepo.setCustomerReadState).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { isRead: "true" },
    { isRead: 1 },
    { isRead: null },
  ])("rejects an invalid payload %p before updating", async (body) => {
    await expect(
      updateCustomerReadState(CUSTOMER, SIGNAL_ID, body)
    ).rejects.toMatchObject({ status: 400, code: "INVALID_READ_STATE" });
    expect(mockedRepo.setCustomerReadState).not.toHaveBeenCalled();
  });

  it("passes only the boolean state for the session user", async () => {
    mockedRepo.setCustomerReadState.mockResolvedValue({
      signalId: SIGNAL_ID,
      readAt: "2026-11-14T11:00:00.000Z",
      isRead: true,
    });
    await updateCustomerReadState(CUSTOMER, SIGNAL_ID, {
      isRead: true,
      readAt: "1999-01-01T00:00:00.000Z",
      userId: OTHER_ID,
      email_status: "SENT",
    });
    expect(mockedRepo.setCustomerReadState).toHaveBeenCalledWith(
      CUSTOMER.userId,
      SIGNAL_ID,
      true
    );
  });

  it("returns 404 when the update matched no owned row", async () => {
    mockedRepo.setCustomerReadState.mockResolvedValue(null);
    await expect(
      updateCustomerReadState(CUSTOMER, SIGNAL_ID, { isRead: false })
    ).rejects.toMatchObject({ status: 404, code: "SIGNAL_NOT_FOUND" });
  });
});

describe("customerUnreadCount", () => {
  it("counts only the session user's unread signals", async () => {
    mockedRepo.countCustomerUnread.mockResolvedValue(4);
    await expect(customerUnreadCount(CUSTOMER)).resolves.toBe(4);
    expect(mockedRepo.countCustomerUnread).toHaveBeenCalledWith(CUSTOMER.userId);
  });
});
