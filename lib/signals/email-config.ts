/**
 * Signals email configuration. SERVER ONLY.
 *
 * Every value is read from the server environment at call time; none is ever
 * written to a log, response body or client bundle. Validation reports only the
 * NAMES of unusable variables, never their values.
 *
 * Gmail is the supported operator mailbox:
 *   * port 465 requires implicit TLS (SIGNALS_SMTP_SECURE=true)
 *   * port 587 requires STARTTLS (SIGNALS_SMTP_SECURE=false)
 *
 * The Signals app URL is deliberately independent of NEXT_PUBLIC_APP_URL and
 * KITE_REDIRECT_URL. Falling back to an unrelated application origin would put
 * a wrong link in a customer email, so a missing or invalid value is a hard
 * configuration failure.
 */

export interface SignalsEmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
  footer: string | null;
  /** Absolute http(s) base URL used to build the customer inbox link. */
  appUrl: string;
}

export type SignalsEmailConfigResult =
  | { ok: true; config: SignalsEmailConfig }
  | { ok: false; problems: string[] };

/** Minimal environment surface so tests can pass a plain object. */
export type SignalsEnv = Readonly<Record<string, string | undefined>>;

const FROM_NAME_MAX_LENGTH = 120;
export const SIGNALS_EMAIL_FOOTER_MAX_LENGTH = 1_000;

const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

function read(env: SignalsEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function isValidAddress(value: string): boolean {
  return value.length <= 320 && EMAIL_PATTERN.test(value);
}

function normalizeFooter(value: string): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolves and validates the full configuration. Returns a discriminated
 * result so callers can fail closed without catching, and so tests can supply
 * an environment object directly.
 */
export function resolveSignalsEmailConfig(
  env: SignalsEnv = process.env
): SignalsEmailConfigResult {
  const problems: string[] = [];

  const host = read(env, "SIGNALS_SMTP_HOST");
  if (!host) {
    problems.push("SIGNALS_SMTP_HOST is missing.");
  } else if (host.length > 253 || /\s/.test(host) || host.includes("://") || host.includes("/")) {
    problems.push("SIGNALS_SMTP_HOST is not a valid SMTP hostname.");
  }

  const portText = read(env, "SIGNALS_SMTP_PORT");
  let port = 0;
  if (!portText) {
    problems.push("SIGNALS_SMTP_PORT is missing.");
  } else if (!/^\d+$/.test(portText)) {
    problems.push("SIGNALS_SMTP_PORT must be a whole number.");
  } else {
    port = Number(portText);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      problems.push("SIGNALS_SMTP_PORT must be between 1 and 65535.");
    }
  }

  const secureText = read(env, "SIGNALS_SMTP_SECURE").toLowerCase();
  let secure = false;
  if (!secureText) {
    problems.push("SIGNALS_SMTP_SECURE is missing.");
  } else if (secureText !== "true" && secureText !== "false") {
    problems.push("SIGNALS_SMTP_SECURE must be true or false.");
  } else {
    secure = secureText === "true";
    if (port === 465 && !secure) {
      problems.push("SIGNALS_SMTP_SECURE must be true for port 465.");
    }
    if (port === 587 && secure) {
      problems.push("SIGNALS_SMTP_SECURE must be false for port 587 (STARTTLS).");
    }
  }

  const user = read(env, "SIGNALS_SMTP_USER");
  if (!user) {
    problems.push("SIGNALS_SMTP_USER is missing.");
  } else if (user.length > 320 || /\s/.test(user) || CONTROL_CHARACTERS.test(user)) {
    problems.push("SIGNALS_SMTP_USER is not valid.");
  }

  const password = read(env, "SIGNALS_SMTP_PASSWORD");
  if (!password) {
    problems.push("SIGNALS_SMTP_PASSWORD is missing.");
  } else if (CONTROL_CHARACTERS.test(password) || /[\r\n]/.test(password)) {
    problems.push("SIGNALS_SMTP_PASSWORD contains unsupported control characters.");
  }

  const fromName = read(env, "SIGNALS_EMAIL_FROM_NAME");
  if (!fromName) {
    problems.push("SIGNALS_EMAIL_FROM_NAME is missing.");
  } else if (
    fromName.length > FROM_NAME_MAX_LENGTH ||
    /[\r\n]/.test(fromName) ||
    CONTROL_CHARACTERS.test(fromName)
  ) {
    problems.push("SIGNALS_EMAIL_FROM_NAME is not a safe display name.");
  }

  const fromAddress = read(env, "SIGNALS_EMAIL_FROM_ADDRESS");
  if (!fromAddress) {
    problems.push("SIGNALS_EMAIL_FROM_ADDRESS is missing.");
  } else if (!isValidAddress(fromAddress)) {
    problems.push("SIGNALS_EMAIL_FROM_ADDRESS is not a valid email address.");
  }

  const replyToRaw = read(env, "SIGNALS_EMAIL_REPLY_TO");
  let replyTo: string | null = null;
  if (replyToRaw) {
    if (!isValidAddress(replyToRaw)) {
      problems.push("SIGNALS_EMAIL_REPLY_TO is not a valid email address.");
    } else {
      replyTo = replyToRaw;
    }
  }

  const footerRaw = env.SIGNALS_EMAIL_FOOTER;
  let footer: string | null = null;
  if (typeof footerRaw === "string" && footerRaw.trim() !== "") {
    footer = normalizeFooter(footerRaw);
    if (footer && [...footer].length > SIGNALS_EMAIL_FOOTER_MAX_LENGTH) {
      problems.push(
        `SIGNALS_EMAIL_FOOTER must be ${SIGNALS_EMAIL_FOOTER_MAX_LENGTH} characters or fewer.`
      );
      footer = null;
    }
  }

  const appUrlText = read(env, "SIGNALS_EMAIL_APP_URL");
  let appUrl = "";
  if (!appUrlText) {
    problems.push("SIGNALS_EMAIL_APP_URL is missing.");
  } else if (/\s/.test(appUrlText) || CONTROL_CHARACTERS.test(appUrlText)) {
    problems.push("SIGNALS_EMAIL_APP_URL is not a valid URL.");
  } else {
    try {
      const parsed = new URL(appUrlText);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        problems.push("SIGNALS_EMAIL_APP_URL must be an absolute http or https URL.");
      } else if (!parsed.hostname) {
        problems.push("SIGNALS_EMAIL_APP_URL must include a hostname.");
      } else if (parsed.username || parsed.password) {
        problems.push("SIGNALS_EMAIL_APP_URL must not contain credentials.");
      } else if (parsed.search || parsed.hash) {
        problems.push("SIGNALS_EMAIL_APP_URL must not contain a query or fragment.");
      } else {
        appUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
      }
    } catch {
      problems.push("SIGNALS_EMAIL_APP_URL is not a valid URL.");
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config: {
      host,
      port,
      secure,
      user,
      password,
      fromName,
      fromAddress,
      replyTo,
      footer,
      appUrl,
    },
  };
}

export function isSignalsEmailConfigured(
  env: SignalsEnv = process.env
): boolean {
  return resolveSignalsEmailConfig(env).ok;
}
