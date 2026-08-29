import { describe, expect, it, vi } from "vitest";
import { MAIL_CATEGORIES, MAIL_DELIVERY } from "#config/constants";
import {
  classifyMailFailure,
  createMailer,
  MailDeliveryError,
  recipientDomain,
  type MailerDeps,
} from "../mailer.ts";
import type { MailTransport, OutboundMail } from "../transport.ts";

const CONTEXT = { category: MAIL_CATEGORIES.emailVerification } as const;

const MAIL: OutboundMail = {
  to: "ada@example.com",
  subject: "Verify your email address for Marketing Dashboard",
  text: "428913",
  html: "<p>428913</p>",
  headers: { "Auto-Submitted": "auto-generated" },
};

function smtpError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("relay said no"), fields);
}

function buildMailer(
  send: MailTransport["send"],
  overrides: { random?: () => number } = {},
) {
  const sleep = vi.fn<MailerDeps["sleep"]>(async () => undefined);
  const transport: MailTransport = {
    kind: "smtp",
    target: "smtp://relay.example:587",
    send,
    verify: async () => undefined,
    close: async () => undefined,
  };

  const mailer = createMailer({
    transport: () => transport,
    sleep,
    random: overrides.random ?? (() => 0.5),
    now: () => 0,
  });

  return { mailer, sleep, send };
}

function accepted() {
  return { messageId: "<abc@relay>", accepted: 1, rejected: 0 };
}

describe("recipientDomain", () => {
  it("keeps the domain and drops the local part, which is personal data", () => {
    expect(recipientDomain("Ada.Lovelace+signup@Example.COM")).toBe(
      "example.com",
    );
  });

  it("does not throw on something that is not an address", () => {
    expect(recipientDomain("not-an-address")).toBe("not-an-address");
    expect(recipientDomain("")).toBe("unknown");
  });
});

describe("classifyMailFailure", () => {
  it("treats a rejected login as permanent — the next attempt has the same password", () => {
    expect(classifyMailFailure(smtpError({ code: "EAUTH" }))).toBe("permanent");
  });

  it("treats a rejected envelope and a rejected message as permanent", () => {
    expect(classifyMailFailure(smtpError({ code: "EENVELOPE" }))).toBe(
      "permanent",
    );
    expect(classifyMailFailure(smtpError({ code: "EMESSAGE" }))).toBe(
      "permanent",
    );
  });

  it("treats a 5xx SMTP reply as permanent", () => {
    expect(classifyMailFailure(smtpError({ responseCode: 550 }))).toBe(
      "permanent",
    );
  });

  it("treats a 4xx SMTP reply as transient — it is the server asking us back", () => {
    expect(classifyMailFailure(smtpError({ responseCode: 421 }))).toBe(
      "transient",
    );
    expect(classifyMailFailure(smtpError({ responseCode: 451 }))).toBe(
      "transient",
    );
  });

  it("treats a socket-level failure as transient", () => {
    expect(classifyMailFailure(smtpError({ code: "ECONNECTION" }))).toBe(
      "transient",
    );
    expect(classifyMailFailure(smtpError({ code: "ETIMEDOUT" }))).toBe(
      "transient",
    );
  });

  it("defaults to transient for anything it does not recognise", () => {
    expect(classifyMailFailure(new Error("who knows"))).toBe("transient");
    expect(classifyMailFailure("a string")).toBe("transient");
  });
});

describe("mailer — happy path", () => {
  it("hands the rendered message to the transport unchanged", async () => {
    const send = vi.fn(async () => accepted());
    const { mailer } = buildMailer(send);

    const result = await mailer.send(MAIL, CONTEXT);

    expect(send).toHaveBeenCalledExactlyOnceWith(MAIL);
    expect(result).toEqual(accepted());
  });
});

describe("mailer — retries", () => {
  it("retries a transient failure and reports the eventual success", async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw smtpError({ responseCode: 421 });
      }
      return accepted();
    });

    const { mailer, sleep } = buildMailer(send);

    await expect(mailer.send(MAIL, CONTEXT)).resolves.toEqual(accepted());
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("gives up after the configured budget rather than holding the request open", async () => {
    const send = vi.fn(async () => {
      throw smtpError({ code: "ECONNECTION" });
    });

    const { mailer } = buildMailer(send);

    await expect(mailer.send(MAIL, CONTEXT)).rejects.toBeInstanceOf(
      MailDeliveryError,
    );
    expect(send).toHaveBeenCalledTimes(MAIL_DELIVERY.maxAttempts);
  });

  it("does not retry a permanent failure — three identical rejections is just latency", async () => {
    const send = vi.fn(async () => {
      throw smtpError({ code: "EAUTH" });
    });

    const { mailer, sleep } = buildMailer(send);

    const failure = await mailer
      .send(MAIL, CONTEXT)
      .catch((error: unknown) => error);

    expect(send).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(MailDeliveryError);
    expect(failure).toMatchObject({ reason: "permanent", attempts: 1 });
  });

  it("backs off further on each attempt, and never past the ceiling", async () => {
    const send = vi.fn(async () => {
      throw smtpError({ responseCode: 451 });
    });

    const { mailer, sleep } = buildMailer(send, { random: () => 1 });

    await expect(mailer.send(MAIL, CONTEXT)).rejects.toBeInstanceOf(
      MailDeliveryError,
    );

    const delays = sleep.mock.calls.map(([ms]) => ms);
    expect(delays).toHaveLength(MAIL_DELIVERY.maxAttempts - 1);
    expect(delays[0]).toBeLessThan(delays[1] ?? Number.POSITIVE_INFINITY);

    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(MAIL_DELIVERY.retryMaxDelayMs);
    }
  });

  it("carries the underlying failure as the cause instead of swallowing it", async () => {
    const cause = smtpError({ code: "EAUTH", responseCode: 535 });
    const { mailer } = buildMailer(
      vi.fn(async () => {
        throw cause;
      }),
    );

    const failure = await mailer
      .send(MAIL, CONTEXT)
      .catch((error: unknown) => error);

    expect((failure as MailDeliveryError).cause).toBe(cause);
  });
});

describe("mailer — timeouts", () => {
  it("abandons an attempt the relay never answers", async () => {
    vi.useFakeTimers();

    try {
      const send = vi.fn(
        async () => new Promise<never>(() => undefined),
      ) as unknown as MailTransport["send"];

      const { mailer } = buildMailer(send);
      const pending = mailer.send(MAIL, CONTEXT);
      const settled = pending.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(
        MAIL_DELIVERY.attemptTimeoutMs * MAIL_DELIVERY.maxAttempts +
          MAIL_DELIVERY.retryMaxDelayMs * MAIL_DELIVERY.maxAttempts,
      );

      expect(await settled).toBeInstanceOf(MailDeliveryError);
    } finally {
      vi.useRealTimers();
    }
  });
});
