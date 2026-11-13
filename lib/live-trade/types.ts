/**
 * Live Trade domain types — request shapes and the resolved owner identity.
 *
 * Repositories accept `LiveTradeOwnerId` instead of a raw string so an owner
 * value can only originate from `resolveLiveTradeOwner`, which resolves the
 * internal DemandScan user from the app session.
 */

import type {
  LiveTradeDirection,
  LiveTradePriority,
  LiveTradeStatus,
  LiveTradeTimeframe,
} from "./constants";

/**
 * Branded owner identifier — an `app_users.user_id` UUID. A plain `string` is
 * not assignable to it; the only producer is the app-session resolver in
 * ./ownership.
 */
export type LiveTradeOwnerId = string & {
  readonly __brand: "LiveTradeOwnerId";
};

export interface LiveTradeOwnerContext {
  ownerId: LiveTradeOwnerId;
}

/** Normalized, validated create payload. Every field has a concrete value. */
export interface CreateLiveTradeItemInput {
  instrumentId: number;
  groupId: string | null;
  priority: LiveTradePriority;
  direction: LiveTradeDirection | null;
  /** `null` means Any timeframe. Omitted in the request becomes "1D". */
  timeframe: LiveTradeTimeframe | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  notes: string;
  tradeStatus: LiveTradeStatus;
}

/**
 * Validated patch. Absent fields are unchanged; `null` clears the field for
 * the nullable columns (groupId, direction, timeframe, prices).
 */
export interface UpdateLiveTradeItemInput {
  version: number;
  groupId?: string | null;
  priority?: LiveTradePriority;
  direction?: LiveTradeDirection | null;
  timeframe?: LiveTradeTimeframe | null;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  notes?: string;
  tradeStatus?: LiveTradeStatus;
}

export interface CreateLiveTradeGroupInput {
  name: string;
}

export interface UpdateLiveTradeGroupInput {
  name: string;
  version: number;
}

export interface LiveTradeReorderInput {
  orderedItemIds: string[];
}

export interface LiveTradeGroupReorderInput {
  orderedGroupIds: string[];
}
