/**
 * System market-data connection storage.
 *
 * Credentials live in market_data_connections, which has no user_id column and
 * is restricted to designation = 'SYSTEM'. Tokens are encrypted with
 * AES-256-GCM and bound to (provider, connection id, token kind) through AAD,
 * so a ciphertext copied into another row cannot be decrypted.
 *
 * Nothing in this module logs or returns a plaintext credential.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { decryptWithAad, encryptWithAad } from "@/lib/crypto";
import type { KiteSession } from "@/lib/types";
import { contextFromKiteSession } from "./context";
import { MarketDataUnavailableError } from "./errors";
import type {
  MarketDataContext,
  MarketDataProviderName,
} from "./types";

export type SystemMarketDataStatus =
  | "ACTIVE"
  | "MISSING"
  | "EXPIRED"
  | "REVOKED"
  | "ERROR";

export type SystemConnectionLoad =
  | {
      status: "ACTIVE";
      connectionId: string;
      provider: MarketDataProviderName;
      tokenExpiresAt: Date | null;
      apiKey: string | null;
      context: MarketDataContext;
    }
  | {
      status: "MISSING" | "EXPIRED" | "REVOKED" | "ERROR";
      provider: MarketDataProviderName;
      connectionId: string | null;
      message: string;
    };

export interface SaveSystemMarketDataInput {
  provider: MarketDataProviderName;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  /** Provider application identifier (public, not a secret). */
  apiKey?: string | null;
  label?: string | null;
}

export interface SystemMarketDataMetadata {
  status: SystemMarketDataStatus;
  provider: MarketDataProviderName;
  connectionId: string | null;
  tokenExpiresAt: Date | null;
  lastSuccessfulUseAt: Date | null;
  updatedAt: Date | null;
  apiKeyConfigured: boolean;
  refreshTokenConfigured: boolean;
}

/**
 * AAD layout. Changing this string invalidates existing ciphertext, so version
 * it explicitly if the binding ever needs to evolve.
 */
export function marketDataAad(
  provider: MarketDataProviderName,
  connectionId: string,
  kind: "access" | "refresh"
): string {
  return `demandscan:market-data:v1:${provider}:${connectionId}:${kind}`;
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function metadataApiKey(value: unknown): string | null {
  const apiKey = metadataObject(value).api_key;
  return typeof apiKey === "string" && apiKey.trim() !== "" ? apiKey.trim() : null;
}

function safeFailure(): string {
  return "The system market-data credentials could not be decrypted. Reconnect the operator account.";
}

/**
 * Load and decrypt the single system connection for a provider.
 *
 * A decryption failure is reported as ERROR and is never treated as MISSING:
 * silently ignoring tampered or key-rotated ciphertext could hide an incident.
 */
export async function loadSystemMarketDataConnection(
  provider: MarketDataProviderName = "KITE"
): Promise<SystemConnectionLoad> {
  const sql = getDb();
  const rows = await sql`
    SELECT connection_id, provider, status, encrypted_access_token,
           encrypted_refresh_token, token_expires_at, provider_metadata
      FROM market_data_connections
     WHERE designation = 'SYSTEM' AND provider = ${provider}
     LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      status: "MISSING",
      provider,
      connectionId: null,
      message: `No system market-data connection is configured for ${provider}.`,
    };
  }

  const row = rows[0] as Record<string, unknown>;
  const connectionId = String(row.connection_id);
  const status = String(row.status);

  if (status === "REVOKED") {
    return {
      status: "REVOKED",
      provider,
      connectionId,
      message: `The system market-data connection for ${provider} is revoked.`,
    };
  }

  if (status === "ERROR") {
    return {
      status: "ERROR",
      provider,
      connectionId,
      message: safeFailure(),
    };
  }

  const tokenExpiresAt = toDate(row.token_expires_at);
  if (status === "EXPIRED" || (tokenExpiresAt && tokenExpiresAt.getTime() <= Date.now())) {
    if (status !== "EXPIRED") {
      await markConnectionStatus(connectionId, "EXPIRED");
    }
    return {
      status: "EXPIRED",
      provider,
      connectionId,
      message: `The system market-data connection for ${provider} has expired.`,
    };
  }

  try {
    const accessToken = decryptWithAad(
      String(row.encrypted_access_token),
      marketDataAad(provider, connectionId, "access")
    );

    const encryptedRefresh = row.encrypted_refresh_token;
    const refreshToken =
      typeof encryptedRefresh === "string" && encryptedRefresh !== ""
        ? decryptWithAad(
            encryptedRefresh,
            marketDataAad(provider, connectionId, "refresh")
          )
        : undefined;

    const apiKey = metadataApiKey(row.provider_metadata);

    return {
      status: "ACTIVE",
      connectionId,
      provider,
      tokenExpiresAt,
      apiKey,
      context: {
        provider,
        credentials: {
          accessToken,
          ...(apiKey ? { apiKey } : {}),
          ...(refreshToken ? { refreshToken } : {}),
        },
        source: "SYSTEM",
        connectionId,
      },
    };
  } catch {
    await markConnectionStatus(connectionId, "ERROR");
    return {
      status: "ERROR",
      provider,
      connectionId,
      message: safeFailure(),
    };
  }
}

async function markConnectionStatus(
  connectionId: string,
  status: SystemMarketDataStatus
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE market_data_connections
       SET status = ${status}, updated_at = NOW()
     WHERE connection_id = ${connectionId}
  `;
}

async function updateExistingConnection(
  connectionId: string,
  input: SaveSystemMarketDataInput
): Promise<void> {
  const provider = input.provider;
  const sql = getDb();

  const encryptedAccessToken = encryptWithAad(
    input.accessToken,
    marketDataAad(provider, connectionId, "access")
  );
  const encryptedRefreshToken = input.refreshToken
    ? encryptWithAad(
        input.refreshToken,
        marketDataAad(provider, connectionId, "refresh")
      )
    : null;
  const metadata = JSON.stringify(
    input.apiKey ? { api_key: input.apiKey } : {}
  );

  await sql`
    UPDATE market_data_connections
       SET label = ${input.label ?? null},
           encrypted_access_token = ${encryptedAccessToken},
           encrypted_refresh_token = ${encryptedRefreshToken},
           token_expires_at = ${input.tokenExpiresAt ?? null},
           status = 'ACTIVE',
           provider_metadata = ${metadata}::jsonb,
           updated_at = NOW()
     WHERE connection_id = ${connectionId}
       AND designation = 'SYSTEM'
  `;
}

/**
 * Create or replace the single system connection for a provider.
 *
 * The connection id must exist before encryption because it is part of the
 * AAD, so an existing row is updated in place and a new id is generated only
 * for the first insert. A concurrent first insert loses the unique
 * (designation, provider) race and is retried once as an update.
 */
export async function saveSystemMarketDataConnection(
  input: SaveSystemMarketDataInput
): Promise<{ connectionId: string }> {
  if (!input.accessToken || input.accessToken.trim() === "") {
    throw new Error("A non-empty access token is required.");
  }

  const sql = getDb();

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await sql`
      SELECT connection_id
        FROM market_data_connections
       WHERE designation = 'SYSTEM' AND provider = ${input.provider}
       LIMIT 1
    `;

    if (existing.length > 0) {
      const connectionId = String((existing[0] as Record<string, unknown>).connection_id);
      await updateExistingConnection(connectionId, input);
      return { connectionId };
    }

    const connectionId = randomUUID();
    const encryptedAccessToken = encryptWithAad(
      input.accessToken,
      marketDataAad(input.provider, connectionId, "access")
    );
    const encryptedRefreshToken = input.refreshToken
      ? encryptWithAad(
          input.refreshToken,
          marketDataAad(input.provider, connectionId, "refresh")
        )
      : null;
    const metadata = JSON.stringify(
      input.apiKey ? { api_key: input.apiKey } : {}
    );

    const inserted = await sql`
      INSERT INTO market_data_connections
        (connection_id, provider, designation, label, encrypted_access_token,
         encrypted_refresh_token, token_expires_at, status, provider_metadata)
      VALUES
        (${connectionId}, ${input.provider}, 'SYSTEM', ${input.label ?? null},
         ${encryptedAccessToken}, ${encryptedRefreshToken},
         ${input.tokenExpiresAt ?? null}, 'ACTIVE', ${metadata}::jsonb)
      ON CONFLICT (designation, provider) DO NOTHING
      RETURNING connection_id
    `;

    if (inserted.length > 0) return { connectionId };
    // Another request created the row between SELECT and INSERT; retry as update.
  }

  throw new Error("Could not persist the system market-data connection.");
}

/**
 * Record a successful provider call. Throttled to once per five minutes so
 * quote polling does not turn every read into a database write.
 */
export async function touchSystemMarketDataConnection(
  connectionId: string
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE market_data_connections
       SET last_successful_use_at = NOW(), updated_at = NOW()
     WHERE connection_id = ${connectionId}
       AND designation = 'SYSTEM'
       AND status = 'ACTIVE'
       AND (last_successful_use_at IS NULL
            OR last_successful_use_at < NOW() - INTERVAL '5 minutes')
  `;
}

/** Best-effort success marker; never affects the caller's result. */
export async function markMarketDataContextUsed(
  context: MarketDataContext
): Promise<void> {
  if (context.source !== "SYSTEM" || !context.connectionId) return;
  try {
    await touchSystemMarketDataConnection(context.connectionId);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.warn(`[market-data] failed to record successful use: ${message}`);
  }
}

export async function revokeSystemMarketDataConnection(
  provider: MarketDataProviderName = "KITE"
): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`
    UPDATE market_data_connections
       SET status = 'REVOKED',
           encrypted_refresh_token = NULL,
           updated_at = NOW()
     WHERE designation = 'SYSTEM' AND provider = ${provider}
     RETURNING connection_id
  `;
  return rows.length > 0;
}

export async function getSystemMarketDataMetadata(
  provider: MarketDataProviderName = "KITE"
): Promise<SystemMarketDataMetadata> {
  const sql = getDb();
  const rows = await sql`
    SELECT connection_id, status, token_expires_at, last_successful_use_at,
           updated_at, provider_metadata, encrypted_refresh_token
      FROM market_data_connections
     WHERE designation = 'SYSTEM' AND provider = ${provider}
     LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      status: "MISSING",
      provider,
      connectionId: null,
      tokenExpiresAt: null,
      lastSuccessfulUseAt: null,
      updatedAt: null,
      apiKeyConfigured: false,
      refreshTokenConfigured: false,
    };
  }

  const row = rows[0] as Record<string, unknown>;
  return {
    status: String(row.status) as SystemMarketDataStatus,
    provider,
    connectionId: String(row.connection_id),
    tokenExpiresAt: toDate(row.token_expires_at),
    lastSuccessfulUseAt: toDate(row.last_successful_use_at),
    updatedAt: toDate(row.updated_at),
    apiKeyConfigured: metadataApiKey(row.provider_metadata) !== null,
    refreshTokenConfigured:
      typeof row.encrypted_refresh_token === "string" &&
      row.encrypted_refresh_token !== "",
  };
}

/**
 * Temporary compatibility policy for the customer-session fallback.
 *
 * Default is enabled outside production and disabled in production, so a
 * deployment cannot silently keep using an ordinary customer's Kite token as
 * the permanent market-data source. `MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK`
 * overrides the default explicitly.
 */
export function allowsCustomerSessionFallback(): boolean {
  const raw = process.env.MARKET_DATA_ALLOW_CUSTOMER_SESSION_FALLBACK?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export interface ResolveMarketDataOptions {
  provider?: MarketDataProviderName;
  session?: KiteSession | null;
  /** Test/route override. Defaults to the env-based policy above. */
  allowCustomerSessionFallback?: boolean;
}

/**
 * Resolve the credential context for shared market-data access.
 *
 * System credentials win. A decrypt/tamper failure is fatal and never falls
 * back to a customer session. The customer-session compatibility path exists
 * only for the current single-operator deployment and is logged explicitly.
 */
export async function resolveMarketDataContext(
  options: ResolveMarketDataOptions = {}
): Promise<MarketDataContext> {
  const provider = options.provider ?? "KITE";
  const system = await loadSystemMarketDataConnection(provider);

  if (system.status === "ACTIVE") return system.context;

  if (system.status === "ERROR") {
    throw new MarketDataUnavailableError(system.message);
  }

  if (options.session) {
    const allowed =
      options.allowCustomerSessionFallback ?? allowsCustomerSessionFallback();
    if (allowed) {
      console.warn(
        `[market-data] system ${provider} connection is ${system.status}; ` +
          "using the temporary customer-session compatibility path. " +
          "Configure an operator system connection before production multi-user use."
      );
      return contextFromKiteSession(options.session);
    }
  }

  throw new MarketDataUnavailableError(system.message);
}
