/**
 * Broker connectivity is separated from ownership.
 *
 * `getBoundKiteSession` must return a Kite session only when the ds_sid cookie
 * is bound to the authenticated app user. An unbound or foreign-bound cookie
 * yields null so callers report BROKER_NOT_CONNECTED instead of borrowing
 * another customer's connection.
 */

import type { KiteSession } from "@/lib/types";

const bindings = new Map<string, string>();
const sessions = new Map<string, Record<string, unknown>>();

jest.mock("@/lib/db", () => ({
  getDb: () => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("kite_session_bindings")) {
        if (/INSERT/i.test(query)) {
          bindings.set(values[0] as string, values[1] as string);
          return [];
        }
        return bindings.get(values[0] as string) === values[1] ? [{ bound: 1 }] : [];
      }
      if (query.includes("kite_sessions")) {
        if (/INSERT/i.test(query)) {
          sessions.set(values[0] as string, {
            encrypted_access_token: values[1] as string,
            user_id: values[2] as string,
            user_name: values[3] as string,
            email: values[4] as string,
            login_time: values[5] as Date,
            expires_at: values[6] as Date,
          });
          return [];
        }
        if (/DELETE/i.test(query)) {
          sessions.delete(values[0] as string);
          return [];
        }
        const row = sessions.get(values[0] as string);
        if (!row) return [];
        if ((row.expires_at as Date).getTime() <= Date.now()) return [];
        return [row];
      }
      return [];
    };
    return sql;
  },
}));

jest.mock("@/lib/crypto", () => ({
  encrypt: (text: string) => `enc:${text}`,
  decrypt: (blob: string) => blob.replace(/^enc:/, ""),
  hashSessionId: (id: string) => `hash:${id}`,
}));

import {
  bindSessionToAppUser,
  getBoundKiteSession,
  sessionStore,
} from "@/lib/kite-session";

const OWNER_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OWNER_B = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
const SESSION_ID = "opaque-cookie-value";

function kiteSession(overrides: Partial<KiteSession> = {}): KiteSession {
  return {
    accessToken: "access-token",
    userId: "ZP0001",
    userName: "Owner",
    email: "owner@example.com",
    loginTime: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function cookieHeader(sessionId = SESSION_ID): string {
  return `other=x; ds_sid=${sessionId}`;
}

beforeEach(() => {
  bindings.clear();
  sessions.clear();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("bindSessionToAppUser", () => {
  it("stores a hash of the cookie value, never the plaintext", async () => {
    await bindSessionToAppUser(SESSION_ID, OWNER_A);
    expect([...bindings.entries()]).toEqual([[`hash:${SESSION_ID}`, OWNER_A]]);
    expect(bindings.has(SESSION_ID)).toBe(false);
  });

  it("rejects an empty session id", async () => {
    await expect(bindSessionToAppUser("", OWNER_A)).rejects.toThrow(
      /sessionId is required/
    );
  });
});

describe("getBoundKiteSession", () => {
  async function arrangeBoundSession(owner = OWNER_A): Promise<KiteSession> {
    const session = kiteSession();
    await sessionStore.set(SESSION_ID, session);
    await bindSessionToAppUser(SESSION_ID, owner);
    return session;
  }

  it("returns the session when the cookie is bound to the app user", async () => {
    const session = await arrangeBoundSession();
    await expect(getBoundKiteSession(cookieHeader(), OWNER_A)).resolves.toEqual(
      session
    );
  });

  it("returns null when no cookie is present", async () => {
    await arrangeBoundSession();
    expect(await getBoundKiteSession(null, OWNER_A)).toBeNull();
    expect(await getBoundKiteSession("other=x", OWNER_A)).toBeNull();
  });

  it("returns null when the app user is blank", async () => {
    await arrangeBoundSession();
    expect(await getBoundKiteSession(cookieHeader(), "")).toBeNull();
  });

  it("returns null for an unknown or expired session", async () => {
    expect(await getBoundKiteSession(cookieHeader(), OWNER_A)).toBeNull();

    await sessionStore.set(SESSION_ID, kiteSession());
    await bindSessionToAppUser(SESSION_ID, OWNER_A);
    sessions.set(`hash:${SESSION_ID}`, {
      ...(sessions.get(`hash:${SESSION_ID}`) ?? {}),
      expires_at: new Date(Date.now() - 60_000),
    });
    expect(await getBoundKiteSession(cookieHeader(), OWNER_A)).toBeNull();
  });

  it("never falls back to a session bound to another customer", async () => {
    await arrangeBoundSession(OWNER_B);
    // A replayed cookie for customer B's broker connection is useless to A.
    expect(await getBoundKiteSession(cookieHeader(), OWNER_A)).toBeNull();
    // The rightful owner still resolves it.
    expect(await getBoundKiteSession(cookieHeader(), OWNER_B)).not.toBeNull();
  });

  it("rejects a session whose Kite user id is blank or too long", async () => {
    await sessionStore.set(SESSION_ID, kiteSession({ userId: "   " }));
    await bindSessionToAppUser(SESSION_ID, OWNER_A);
    expect(await getBoundKiteSession(cookieHeader(), OWNER_A)).toBeNull();

    await sessionStore.set(SESSION_ID, kiteSession({ userId: "x".repeat(65) }));
    await bindSessionToAppUser(SESSION_ID, OWNER_A);
    expect(await getBoundKiteSession(cookieHeader(), OWNER_A)).toBeNull();
  });
});
