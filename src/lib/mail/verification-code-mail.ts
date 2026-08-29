import { randomUUID } from "node:crypto";
import {
  EMAIL_VERIFICATION,
  MAIL_CATEGORIES,
  MAIL_EVENTS,
  PRODUCT_NAME,
} from "#config/constants";
import { env } from "#config/env";
import { logger } from "#observability/logger";
import { mailer, recipientDomain, type Mailer } from "./mailer.ts";
import {
  buildVerifyUrl,
  renderVerificationCodeEmail,
} from "./templates/verification-code.template.ts";

const log = logger.child({ component: "mail" });

export type VerificationCodeMail = {
  readonly email: string;
  readonly code: string;
  readonly expiresAt: Date;
};

export type VerificationCodeMailDeps = {
  readonly mailer: Mailer;
  readonly webAppBaseUrl: string;
  readonly newEntityRef: () => string;
};

const defaultDeps: VerificationCodeMailDeps = {
  mailer,
  webAppBaseUrl: env.WEB_APP_BASE_URL,
  newEntityRef: () => randomUUID(),
};

function transactionalHeaders(entityRef: string): Record<string, string> {
  return {
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "All",
    "X-Entity-Ref-ID": entityRef,
  };
}

export function createVerificationCodeDelivery(
  overrides: Partial<VerificationCodeMailDeps> = {},
) {
  const deps: VerificationCodeMailDeps = { ...defaultDeps, ...overrides };

  return async function deliverVerificationCode(
    mail: VerificationCodeMail,
  ): Promise<void> {
    const rendered = renderVerificationCodeEmail({
      code: mail.code,
      expiresInMinutes: Math.round(EMAIL_VERIFICATION.ttlSeconds / 60),
      verifyUrl: buildVerifyUrl(deps.webAppBaseUrl, mail.email),
      productName: PRODUCT_NAME,
    });

    try {
      const result = await deps.mailer.send(
        {
          to: mail.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          headers: transactionalHeaders(deps.newEntityRef()),
        },
        { category: MAIL_CATEGORIES.emailVerification },
      );

      log.info(
        {
          event: MAIL_EVENTS.verificationCodeDelivered,
          recipientDomain: recipientDomain(mail.email),
          messageId: result.messageId,
          expiresAt: mail.expiresAt.toISOString(),
        },
        "verification code emailed",
      );
    } catch (error) {
      log.error(
        {
          err: error,
          event: MAIL_EVENTS.verificationCodeNotDelivered,
          recipientDomain: recipientDomain(mail.email),
          expiresAt: mail.expiresAt.toISOString(),
          remediation:
            "the account exists and is unverified — the user can request a new code via POST /v1/auth/verify-email/resend",
        },
        "verification code was issued but could not be emailed",
      );
    }
  };
}

export const deliverVerificationCode = createVerificationCodeDelivery();
