/**
 * Scheduled dispatch endpoint: bearer-only gate, fail-closed behaviour and a
 * response that contains counts but no addresses, credentials or transport
 * details.
 */

jest.mock("@/lib/signals/dispatcher", () => ({
  dispatchDueSignals: jest.fn(),
}));

jest.mock("@/lib/signals/email-config", () => ({
  resolveSignalsEmailConfig: jest.fn(),
}));

jest.mock("@/lib/signals/email-transport", () => ({
  createSignalsEmailTransport: jest.fn(() => ({
    sendMail: jest.fn(),
    close: jest.fn(),
  })),
}));

import { NextRequest } from "next/server";
import * as dispatcher from "@/lib/signals/dispatcher";
import * as config from "@/lib/signals/email-config";
import * as transport from "@/lib/signals/email-transport";
import { POST } from "@/app/api/internal/signals/dispatch/route";

const mockedDispatch = dispatcher.dispatchDueSignals as jest.MockedFunction<
  typeof dispatcher.dispatchDueSignals
>;
const mockedConfig = config.resolveSignalsEmailConfig as jest.MockedFunction<
  typeof config.resolveSignalsEmailConfig
>;
const mockedTransport = transport.createSignalsEmailTransport as jest.MockedFunction<
  typeof transport.createSignalsEmailTransport
>;

const SECRET = "cron-secret-value-1234567890";

const EMAIL_CONFIG: config.SignalsEmailConfig = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "signals@example.com",
  password: "app-password-secret",
  fromName: "DemandScan Signals",
  fromAddress: "signals@example.com",
  replyTo: null,
  footer: "Footer.",
  appUrl: "https://app.example.com",
};

const SUMMARY = {
  claimed: 2,
  sent: 1,
  failed: 0,
  terminalFailures: 0,
  skipped: 1,
  leaseLost: 0,
  deferred: 0,
};

function request(headers: Record<string, string> = {}, body?: unknown): NextRequest {
  return new NextRequest(
    new URL("/api/internal/signals/dispatch", "https://app.test"),
    {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = SECRET;
  mockedConfig.mockReturnValue({ ok: true, config: EMAIL_CONFIG });
  mockedDispatch.mockResolvedValue(SUMMARY);
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("authorization", () => {
  it("rejects a request without a Bearer credential", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it("rejects an incorrect Bearer credential", async () => {
    const response = await POST(request({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "DISPATCH_NOT_CONFIGURED",
    });
    expect(mockedDispatch).not.toHaveBeenCalled();
  });
});

describe("configuration and dispatch", () => {
  it("refuses to dispatch when email configuration is invalid", async () => {
    mockedConfig.mockReturnValue({
      ok: false,
      problems: ["SIGNALS_SMTP_HOST is missing."],
    });

    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "EMAIL_NOT_CONFIGURED",
    });
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it("returns sanitized counts for a valid scheduler call", async () => {
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, dispatch: SUMMARY });
    expect(mockedTransport).toHaveBeenCalledWith(EMAIL_CONFIG);
    expect(mockedDispatch).toHaveBeenCalledWith({
      config: EMAIL_CONFIG,
      transport: mockedTransport.mock.results[0].value,
    });

    const serialized = JSON.stringify(body);
    for (const secret of [
      SECRET,
      EMAIL_CONFIG.password,
      EMAIL_CONFIG.user,
      EMAIL_CONFIG.host,
      "app-password-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("ignores any caller-supplied work", async () => {
    await POST(
      request(
        { authorization: `Bearer ${SECRET}` },
        { recipientIds: ["aaaaaaaa-1111-4111-8111-111111111111"], message: "fake" }
      )
    );

    const args = mockedDispatch.mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(["config", "transport"]);
  });

  it("maps an internal failure to a generic 503", async () => {
    mockedDispatch.mockRejectedValue(
      new Error("smtp.gmail.com rejected app-password-secret")
    );

    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "DISPATCH_UNAVAILABLE" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("app-password-secret");
    expect(serialized).not.toContain("smtp.gmail.com");
  });
});
