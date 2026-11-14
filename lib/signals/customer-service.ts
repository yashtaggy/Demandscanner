/**
 * Customer-facing Signals rules. SERVER ONLY.
 *
 * Authorization happens in the route (requireCustomer). Identity is always the
 * session's internal app_users.user_id; no function here accepts a customer id
 * from the request. A signal the caller was not assigned is reported as 404 so
 * the API never confirms whether another customer's signal exists.
 */

import type { AppUser } from "@/lib/auth/types";
import { SignalsError } from "./errors";
import {
  countCustomerUnread,
  findCustomerSignal,
  listCustomerInbox,
  setCustomerReadState as updateReadState,
} from "./repository";
import type {
  CustomerReadState,
  CustomerSignalDetail,
  CustomerSignalInbox,
} from "./types";
import { isValidUuid, parseInboxQuery, parseReadState } from "./validation";

function notFound(): never {
  throw new SignalsError(404, "SIGNAL_NOT_FOUND", "Signal not found.");
}

export async function customerInbox(
  actor: AppUser,
  params: URLSearchParams
): Promise<CustomerSignalInbox> {
  const query = parseInboxQuery(params);
  return listCustomerInbox(actor.userId, query.page, query.pageSize);
}

export async function customerSignal(
  actor: AppUser,
  signalId: string
): Promise<CustomerSignalDetail> {
  if (!isValidUuid(signalId)) notFound();
  const signal = await findCustomerSignal(actor.userId, signalId);
  if (!signal) notFound();
  return signal;
}

export async function updateCustomerReadState(
  actor: AppUser,
  signalId: string,
  body: Record<string, unknown>
): Promise<CustomerReadState> {
  if (!isValidUuid(signalId)) notFound();
  const isRead = parseReadState(body);
  const state = await updateReadState(actor.userId, signalId, isRead);
  if (!state) notFound();
  return state;
}

export async function customerUnreadCount(actor: AppUser): Promise<number> {
  return countCustomerUnread(actor.userId);
}
