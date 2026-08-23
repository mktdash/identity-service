import { isProduction } from "#config/env";
import { logger } from "#observability/logger";

const log = logger.child({ component: "mail" });

export type VerificationCodeMail = {
  readonly email: string;
  readonly code: string;
  readonly expiresAt: Date;
};

export async function deliverVerificationCode(
  mail: VerificationCodeMail,
): Promise<void> {
  if (isProduction) {
    log.error(
      {
        event: "verification_email_not_delivered",
        userEmailDomain: mail.email.split("@")[1] ?? "unknown",
        expiresAt: mail.expiresAt.toISOString(),
      },
      "no mail transport is configured — the verification code was generated but not sent",
    );
    return;
  }

  log.info(
    {
      event: "verification_email_delivered",
      transport: "console",
      expiresAt: mail.expiresAt.toISOString(),
    },
    "DEV ONLY — verification code printed to the console because no mail transport is configured",
  );

  process.stdout.write(
    `\n  ┌─ DEV EMAIL ─────────────────────────────────\n` +
      `  │ to   : ${mail.email}\n` +
      `  │ code : ${mail.code}\n` +
      `  │ until: ${mail.expiresAt.toISOString()}\n` +
      `  └─────────────────────────────────────────────\n\n`,
  );

  await Promise.resolve();
}
