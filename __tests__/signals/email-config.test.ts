/**
 * Signals email configuration validation. No transport is created and no
 * environment value is ever logged or returned by the validator.
 */

import {
  isSignalsEmailConfigured,
  resolveSignalsEmailConfig,
} from "@/lib/signals/email-config";

const SECRET_PASSWORD = "super-secret-app-password-value";

type TestEnv = Record<string, string | undefined>;

function baseEnv(overrides: TestEnv = {}): TestEnv {
  return {
    SIGNALS_SMTP_HOST: "smtp.gmail.com",
    SIGNALS_SMTP_PORT: "587",
    SIGNALS_SMTP_SECURE: "false",
    SIGNALS_SMTP_USER: "signals@example.com",
    SIGNALS_SMTP_PASSWORD: SECRET_PASSWORD,
    SIGNALS_EMAIL_FROM_NAME: "DemandScan Signals",
    SIGNALS_EMAIL_FROM_ADDRESS: "signals@example.com",
    SIGNALS_EMAIL_APP_URL: "https://app.example.com",
    ...overrides,
  };
}

function problemsOf(env: TestEnv): string[] {
  const result = resolveSignalsEmailConfig(env);
  return result.ok ? [] : result.problems;
}

describe("required configuration", () => {
  it("fails safely when every required value is missing", () => {
    const result = resolveSignalsEmailConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const key of [
      "SIGNALS_SMTP_HOST",
      "SIGNALS_SMTP_PORT",
      "SIGNALS_SMTP_SECURE",
      "SIGNALS_SMTP_USER",
      "SIGNALS_SMTP_PASSWORD",
      "SIGNALS_EMAIL_FROM_NAME",
      "SIGNALS_EMAIL_FROM_ADDRESS",
      "SIGNALS_EMAIL_APP_URL",
    ]) {
      expect(result.problems.join(" ")).toContain(key);
    }
    expect(isSignalsEmailConfigured({})).toBe(false);
  });

  it("never includes a configured value in validation output", () => {
    const result = resolveSignalsEmailConfig(
      baseEnv({ SIGNALS_SMTP_HOST: "bad host", SIGNALS_SMTP_PASSWORD: SECRET_PASSWORD })
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET_PASSWORD);
    expect(JSON.stringify(result)).not.toContain("signals@example.com");
  });

  it("accepts a complete port 587 STARTTLS configuration", () => {
    const result = resolveSignalsEmailConfig(baseEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "signals@example.com",
      fromName: "DemandScan Signals",
      fromAddress: "signals@example.com",
      replyTo: null,
      footer: null,
      appUrl: "https://app.example.com",
    });
    expect(result.config.password).toBe(SECRET_PASSWORD);
  });

  it("accepts a complete port 465 implicit-TLS configuration", () => {
    const result = resolveSignalsEmailConfig(
      baseEnv({ SIGNALS_SMTP_PORT: "465", SIGNALS_SMTP_SECURE: "true" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.secure).toBe(true);
  });
});

describe("invalid transport values", () => {
  it("rejects ports and booleans that cannot be used", () => {
    expect(problemsOf(baseEnv({ SIGNALS_SMTP_PORT: "abc" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("whole number")])
    );
    expect(problemsOf(baseEnv({ SIGNALS_SMTP_PORT: "70000" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("between 1 and 65535")])
    );
    expect(problemsOf(baseEnv({ SIGNALS_SMTP_SECURE: "yes" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("true or false")])
    );
  });

  it("rejects TLS mode mismatches for the Gmail ports", () => {
    expect(
      problemsOf(baseEnv({ SIGNALS_SMTP_PORT: "465", SIGNALS_SMTP_SECURE: "false" }))
    ).toEqual(expect.arrayContaining([expect.stringContaining("port 465")]));
    expect(
      problemsOf(baseEnv({ SIGNALS_SMTP_PORT: "587", SIGNALS_SMTP_SECURE: "true" }))
    ).toEqual(expect.arrayContaining([expect.stringContaining("port 587")]));
  });

  it("rejects header injection attempts in sender fields", () => {
    expect(
      problemsOf(baseEnv({ SIGNALS_EMAIL_FROM_NAME: "Signals\r\nBcc: a@b.com" }))
    ).toEqual(expect.arrayContaining([expect.stringContaining("display name")]));
    expect(
      problemsOf(baseEnv({ SIGNALS_EMAIL_FROM_ADDRESS: "not-an-address" }))
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("SIGNALS_EMAIL_FROM_ADDRESS")])
    );
    expect(
      problemsOf(baseEnv({ SIGNALS_EMAIL_REPLY_TO: "bad@\r\n" }))
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("SIGNALS_EMAIL_REPLY_TO")])
    );
  });
});

describe("Signals app URL", () => {
  it("does not fall back to another application URL", () => {
    const problems = problemsOf({
      ...baseEnv(),
      SIGNALS_EMAIL_APP_URL: "",
      NEXT_PUBLIC_APP_URL: "https://unrelated.example.com",
      KITE_REDIRECT_URL: "https://unrelated.example.com/api/kite/callback",
    });
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining("SIGNALS_EMAIL_APP_URL")])
    );
  });

  it("rejects relative, credentialed and non-http URLs", () => {
    for (const value of [
      "/signals",
      "ftp://app.example.com",
      "https://user:pass@app.example.com",
      "https://app.example.com/?token=1",
    ]) {
      expect(problemsOf(baseEnv({ SIGNALS_EMAIL_APP_URL: value }))).toEqual(
        expect.arrayContaining([expect.stringContaining("SIGNALS_EMAIL_APP_URL")])
      );
    }
  });

  it("keeps a subpath base and removes a trailing slash", () => {
    const result = resolveSignalsEmailConfig(
      baseEnv({ SIGNALS_EMAIL_APP_URL: "https://app.example.com/demandscan/" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.appUrl).toBe("https://app.example.com/demandscan");
    }
  });
});

describe("optional values", () => {
  it("normalizes the footer and keeps an optional reply-to", () => {
    const result = resolveSignalsEmailConfig(
      baseEnv({
        SIGNALS_EMAIL_FOOTER: "  Line one\r\nLine two  ",
        SIGNALS_EMAIL_REPLY_TO: "support@example.com",
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.footer).toBe("Line one\nLine two");
    expect(result.config.replyTo).toBe("support@example.com");
  });
});
