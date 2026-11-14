/**
 * SMTP transport behaviour with nodemailer mocked. No socket is opened and no
 * message leaves the process.
 */

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}));

import nodemailer from "nodemailer";
import type { SignalsEmailConfig } from "@/lib/signals/email-config";
import {
  classifySmtpError,
  createSignalsEmailTransport,
  sendSignalEmail,
  type SignalsEmailTransport,
} from "@/lib/signals/email-transport";

const mockedCreateTransport = nodemailer.createTransport as unknown as jest.Mock;

const CONFIG: SignalsEmailConfig = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "signals@example.com",
  password: "app-password-secret",
  fromName: "DemandScan Signals",
  fromAddress: "signals@example.com",
  replyTo: "support@example.com",
  footer: null,
  appUrl: "https://app.example.com",
};

const MESSAGE_ID = "<signal.dddd.recipient.eeee@example.com>";

function fakeTransport(
  sendMail: jest.Mock = jest.fn().mockResolvedValue({ accepted: ["customer@example.com"] })
): SignalsEmailTransport {
  return { sendMail, close: jest.fn() };
}

beforeEach(() => {
  mockedCreateTransport.mockReset();
});

describe("transport construction", () => {
  it("uses implicit TLS on 465 and STARTTLS on 587 with bounded timeouts", () => {
    mockedCreateTransport.mockReturnValue({});
    createSignalsEmailTransport(CONFIG);
    const options = mockedCreateTransport.mock.calls[0][0];
    expect(options).toMatchObject({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "signals@example.com", pass: "app-password-secret" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
      tls: { minVersion: "TLSv1.2" },
    });

    mockedCreateTransport.mockReturnValue({});
    createSignalsEmailTransport({ ...CONFIG, port: 465, secure: true });
    expect(mockedCreateTransport.mock.calls[1][0]).toMatchObject({
      port: 465,
      secure: true,
      requireTLS: false,
    });
  });
});

describe("sendSignalEmail", () => {
  it("sends the deterministic Message-ID and configured identity", async () => {
    const transport = fakeTransport();
    await sendSignalEmail(transport, {
      config: CONFIG,
      to: "customer@example.com",
      subject: "Buy NIFTY",
      text: "Buy NIFTY\n\nView this signal",
      messageId: MESSAGE_ID,
    });

    expect(transport.sendMail).toHaveBeenCalledWith({
      from: { name: "DemandScan Signals", address: "signals@example.com" },
      to: "customer@example.com",
      replyTo: "support@example.com",
      subject: "Buy NIFTY",
      text: "Buy NIFTY\n\nView this signal",
      messageId: MESSAGE_ID,
    });
  });

  it("treats an empty accepted list as a failed hand-off", async () => {
    const transport = fakeTransport(
      jest.fn().mockResolvedValue({ accepted: [], rejected: ["customer@example.com"] })
    );
    await expect(
      sendSignalEmail(transport, {
        config: CONFIG,
        to: "customer@example.com",
        subject: "S",
        text: "T",
        messageId: MESSAGE_ID,
      })
    ).rejects.toMatchObject({ code: "SMTP_NOT_ACCEPTED" });
  });

  it("never echoes credentials, hosts or server banners in an error", async () => {
    const transport = fakeTransport(
      jest.fn().mockRejectedValue(
        Object.assign(
          new Error(
            "535 5.7.8 app-password-secret rejected at smtp.gmail.com for signals@example.com"
          ),
          { code: "EAUTH", responseCode: 535 }
        )
      )
    );

    let caught: unknown;
    try {
      await sendSignalEmail(transport, {
        config: CONFIG,
        to: "customer@example.com",
        subject: "S",
        text: "T",
        messageId: MESSAGE_ID,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({ code: "SMTP_AUTH_FAILED" });
    const serialized = `${(caught as Error).message} ${JSON.stringify(caught)}`;
    expect(serialized).not.toContain("app-password-secret");
    expect(serialized).not.toContain("smtp.gmail.com");
    expect(serialized).not.toContain("signals@example.com");
  });
});

describe("error classification", () => {
  it.each([
    [{ code: "EAUTH" }, "SMTP_AUTH_FAILED"],
    [{ code: "ETIMEDOUT" }, "SMTP_TIMEOUT"],
    [{ code: "ECONNRESET" }, "SMTP_TIMEOUT"],
    [{ code: "ECONNECTION" }, "SMTP_CONNECTION_FAILED"],
    [{ code: "ESOCKET" }, "SMTP_CONNECTION_FAILED"],
    [{ code: "ENOTFOUND" }, "SMTP_CONNECTION_FAILED"],
    [{ code: "EENVELOPE" }, "SMTP_ENVELOPE_REJECTED"],
    [{ code: "EOTHER", responseCode: 550 }, "SMTP_SERVER_REJECTED"],
    [{ code: "EOTHER" }, "SMTP_DELIVERY_FAILED"],
    [new Error("raw driver text"), "SMTP_DELIVERY_FAILED"],
  ] as const)("maps %p to %s", (error, expected) => {
    const classified = classifySmtpError(error);
    expect(classified.code).toBe(expected);
    expect(classified.message.length).toBeLessThanOrEqual(500);
    expect(classified.message).not.toContain("raw driver text");
  });
});
