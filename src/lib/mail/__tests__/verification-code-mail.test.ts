import { describe, expect, it, vi } from "vitest";
import { EMAIL_VERIFICATION, MAIL_CATEGORIES } from "#config/constants";
import { MailDeliveryError, type Mailer } from "../mailer.ts";
import type { MailSendResult, OutboundMail } from "../transport.ts";
import { createVerificationCodeDelivery } from "../verification-code-mail.ts";

const MAIL = {
  email: "Ada@Example.com",
  code: "428913",
  expiresAt: new Date("2026-01-01T00:15:00.000Z"),
};

function buildDelivery(
  send: Mailer["send"] = vi.fn(
    async (): Promise<MailSendResult> => ({
      messageId: "<abc@relay>",
      accepted: 1,
      rejected: 0,
    }),
  ),
) {
  const mailer: Mailer = { send };

  const deliver = createVerificationCodeDelivery({
    mailer,
    webAppBaseUrl: "https://app.mktdash.io",
    newEntityRef: () => "01920000-0000-7000-8000-0000000000ff",
  });

  return { deliver, send };
}

function sentMessage(send: Mailer["send"]): OutboundMail {
  const call = vi.mocked(send).mock.calls[0];
  if (call === undefined) {
    throw new Error("expected the mailer to have been called");
  }

  return call[0];
}

describe("deliverVerificationCode", () => {
  it("sends to the address as the user typed it", async () => {
    const { deliver, send } = buildDelivery();
    await deliver(MAIL);

    expect(sentMessage(send).to).toBe("Ada@Example.com");
  });

  it("tags the send so the category is greppable in the log pipeline", async () => {
    const { deliver, send } = buildDelivery();
    await deliver(MAIL);

    expect(vi.mocked(send).mock.calls[0]?.[1]).toEqual({
      category: MAIL_CATEGORIES.emailVerification,
    });
  });

  it("carries the code in both the text and HTML parts", async () => {
    const { deliver, send } = buildDelivery();
    await deliver(MAIL);

    const message = sentMessage(send);
    expect(message.text).toContain("428913");
    expect(message.html).toContain("428913");
  });

  it("states the real TTL rather than a hard-coded number", async () => {
    const { deliver, send } = buildDelivery();
    await deliver(MAIL);

    expect(sentMessage(send).text).toContain(
      `valid for ${String(EMAIL_VERIFICATION.ttlSeconds / 60)} minutes`,
    );
  });

  it("links to the verify page for that address, with no code in the URL", async () => {
    const { deliver, send } = buildDelivery();
    await deliver(MAIL);

    const message = sentMessage(send);
    expect(message.text).toContain(
      "https://app.mktdash.io/verify-email?email=Ada%40Example.com",
    );
    expect(message.text).not.toContain("code=428913");
  });

  it("suppresses autoresponders and gives each code its own thread", async () => {
    const { deliver, send } = buildDelivery();
    await deliver(MAIL);

    expect(sentMessage(send).headers).toEqual({
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "X-Entity-Ref-ID": "01920000-0000-7000-8000-0000000000ff",
    });
  });

  it("keeps the code out of the subject", async () => {
    const { deliver, send } = buildDelivery();
    await deliver(MAIL);

    expect(sentMessage(send).subject).not.toContain("428913");
  });
});

describe("deliverVerificationCode — the relay is down", () => {
  it("does not throw: the tenant is already committed and the caller cannot retry", async () => {
    const { deliver } = buildDelivery(
      vi.fn(async () => {
        throw new MailDeliveryError({
          reason: "transient",
          attempts: 3,
          category: MAIL_CATEGORIES.emailVerification,
          cause: new Error("ECONNREFUSED"),
        });
      }),
    );

    await expect(deliver(MAIL)).resolves.toBeUndefined();
  });

  it("swallows an unexpected failure the same way, rather than 500-ing a successful sign-up", async () => {
    const { deliver } = buildDelivery(
      vi.fn(async () => {
        throw new TypeError("something unexpected");
      }),
    );

    await expect(deliver(MAIL)).resolves.toBeUndefined();
  });
});
