/**
 * Bearer-secret gate for the scheduled dispatcher.
 */

import {
  getCronSecret,
  verifyDispatchAuthorization,
} from "@/lib/signals/cron-auth";

const SECRET = "cron-secret-value-1234567890";

describe("dispatcher authorization", () => {
  it("accepts the configured Bearer secret", () => {
    expect(
      verifyDispatchAuthorization(`Bearer ${SECRET}`, { CRON_SECRET: SECRET })
    ).toEqual({ ok: true });
    expect(
      verifyDispatchAuthorization(`bearer ${SECRET}`, { CRON_SECRET: SECRET })
    ).toEqual({ ok: true });
    expect(
      verifyDispatchAuthorization(`Bearer    ${SECRET}   `, { CRON_SECRET: SECRET })
    ).toEqual({ ok: true });
  });

  it("rejects a missing, malformed or incorrect credential", () => {
    const env = { CRON_SECRET: SECRET };
    for (const header of [
      null,
      undefined,
      "",
      SECRET,
      "Basic abc",
      "Bearer",
      "Bearer wrong-secret",
      `Bearer ${SECRET} extra`,
    ]) {
      expect(verifyDispatchAuthorization(header, env)).toMatchObject({
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
  });

  it("fails closed when the server secret is not configured", () => {
    const result = verifyDispatchAuthorization(`Bearer ${SECRET}`, {});
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "DISPATCH_NOT_CONFIGURED",
    });
    expect(getCronSecret({ CRON_SECRET: "   " })).toBeNull();
  });

  it("never returns the secret in a failure result", () => {
    const result = verifyDispatchAuthorization("Bearer wrong", {
      CRON_SECRET: SECRET,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
