/**
 * Gmail-compatible SMTP transport for Signals. SERVER ONLY.
 *
 * Credentials live only in this process. Transport objects, SMTP responses and
 * driver errors are never logged or returned: diagnostics leave this module
 * only as a bounded code and a fixed, sanitized message.
 */

import nodemailer from "nodemailer";
import type { SendMailOptions, SentMessageInfo } from "nodemailer";
import type { SignalsEmailConfig } from "./email-config";

/**
 * The narrow transport surface the dispatcher needs. Nodemailer's Transporter
 * satisfies it, and tests can supply a fake without opening a socket.
 */
export interface SignalsEmailTransport {
  sendMail(options: SendMailOptions): Promise<SentMessageInfo>;
  close?: () => void;
}

export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 15_000;

/**
 * Configured upper bound for one sendMail attempt: connection, greeting and a
 * socket inactivity window. `socketTimeout` measures inactivity rather than
 * total time, so this is the bound the options impose, not a guarantee against
 * a server that keeps trickling bytes. Callers use it to decide whether a new
 * attempt can still finish inside the invocation.
 */
export const SMTP_ATTEMPT_TIMEOUT_MS =
  SMTP_CONNECTION_TIMEOUT_MS +
  SMTP_GREETING_TIMEOUT_MS +
  SMTP_SOCKET_TIMEOUT_MS;

export interface SanitizedEmailError {
  /** Stored in signal_email_attempts.error_code (max 80 characters). */
  code: string;
  /** Stored in signal_email_attempts.error_message (max 500 characters). */
  message: string;
}

export class SignalEmailDeliveryError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(code: string, safeMessage: string) {
    super(safeMessage);
    this.name = "SignalEmailDeliveryError";
    this.code = code.slice(0, 80);
    this.safeMessage = safeMessage.slice(0, 500);
  }
}

export function createSignalsEmailTransport(
  config: SignalsEmailConfig
): SignalsEmailTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Port 587 upgrades with STARTTLS. Requiring TLS also fails closed if the
    // server refuses the upgrade instead of silently sending in the clear.
    requireTLS: !config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
    tls: {
      minVersion: "TLSv1.2",
    },
  });
}

export interface SendSignalEmailParams {
  config: SignalsEmailConfig;
  to: string;
  subject: string;
  text: string;
  messageId: string;
}

/**
 * Hands one message to the SMTP server. Resolving means the server accepted
 * the message for delivery; it is not proof of inbox delivery or reading.
 */
export async function sendSignalEmail(
  transport: SignalsEmailTransport,
  params: SendSignalEmailParams
): Promise<void> {
  let info: SentMessageInfo;
  try {
    info = await transport.sendMail({
      from: {
        name: params.config.fromName,
        address: params.config.fromAddress,
      },
      to: params.to,
      replyTo: params.config.replyTo ?? undefined,
      subject: params.subject,
      text: params.text,
      messageId: params.messageId,
    });
  } catch (err) {
    const classified = classifySmtpError(err);
    throw new SignalEmailDeliveryError(classified.code, classified.message);
  }

  const accepted = Array.isArray(info?.accepted) ? info.accepted.length : 0;
  if (accepted === 0) {
    throw new SignalEmailDeliveryError(
      "SMTP_NOT_ACCEPTED",
      "The SMTP server did not accept the message for delivery."
    );
  }
}

function driverCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const value = (err as { code?: unknown }).code;
    return typeof value === "string" ? value : "";
  }
  return "";
}

function responseCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const value = (err as { responseCode?: unknown }).responseCode;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (!/^\d{3}$/.test(String(value))) return null;
  return Number(value);
}

/**
 * Maps any transport failure to fixed diagnostics. Raw messages often contain
 * the SMTP host, username or server banner, so they are never propagated.
 */
export function classifySmtpError(err: unknown): SanitizedEmailError {
  if (err instanceof SignalEmailDeliveryError) {
    return { code: err.code, message: err.safeMessage };
  }

  const code = driverCode(err);
  if (code === "EAUTH") {
    return {
      code: "SMTP_AUTH_FAILED",
      message: "The SMTP server rejected the configured credentials.",
    };
  }
  if (code === "ETIMEDOUT" || code === "ECONNRESET") {
    return {
      code: "SMTP_TIMEOUT",
      message: "The SMTP server did not respond in time.",
    };
  }
  if (
    code === "ECONNECTION" ||
    code === "ESOCKET" ||
    code === "EDNS" ||
    code === "ENOTFOUND"
  ) {
    return {
      code: "SMTP_CONNECTION_FAILED",
      message: "A connection to the SMTP server could not be established.",
    };
  }
  if (code === "EENVELOPE") {
    return {
      code: "SMTP_ENVELOPE_REJECTED",
      message: "The SMTP server rejected the sender or recipient address.",
    };
  }

  const smtpResponse = responseCode(err);
  if (smtpResponse !== null) {
    return {
      code: "SMTP_SERVER_REJECTED",
      message: `The SMTP server rejected the message (response ${smtpResponse}).`,
    };
  }

  return {
    code: "SMTP_DELIVERY_FAILED",
    message: "The message could not be handed to the SMTP server.",
  };
}
