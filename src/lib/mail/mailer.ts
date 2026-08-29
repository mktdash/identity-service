import {
  MAIL_DELIVERY,
  MAIL_EVENTS,
  type MailCategory,
} from "#config/constants";
import { logger } from "#observability/logger";
import {
  getMailTransport,
  type MailSendResult,
  type MailTransport,
  type OutboundMail,
} from "./transport.ts";

const log = logger.child({ component: "mail" });

export type MailFailureKind = "transient" | "permanent";

const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "EAUTH",
  "EENVELOPE",
  "EMESSAGE",
]);

export function classifyMailFailure(error: unknown): MailFailureKind {
  if (!(error instanceof Error)) {
    return "transient";
  }

  const fields = error as unknown as Record<string, unknown>;

  const code = fields["code"];
  if (typeof code === "string" && PERMANENT_ERROR_CODES.has(code)) {
    return "permanent";
  }

  const responseCode = fields["responseCode"];
  if (
    typeof responseCode === "number" &&
    responseCode >= 500 &&
    responseCode < 600
  ) {
    return "permanent";
  }

  return "transient";
}

export class MailTimeoutError extends Error {
  readonly operation: string;

  constructor(operation: string, timeoutMs: number) {
    super(`${operation} did not complete within ${String(timeoutMs)}ms`);
    this.name = "MailTimeoutError";
    this.operation = operation;
  }
}

export class MailDeliveryError extends Error {
  readonly reason: MailFailureKind;
  readonly attempts: number;
  readonly category: string;

  constructor(options: {
    reason: MailFailureKind;
    attempts: number;
    category: string;
    cause: unknown;
  }) {
    super(
      `mail delivery failed after ${String(options.attempts)} attempt(s) (${options.reason})`,
      { cause: options.cause },
    );
    this.name = "MailDeliveryError";
    this.reason = options.reason;
    this.attempts = options.attempts;
    this.category = options.category;
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new MailTimeoutError(label, timeoutMs));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function recipientDomain(address: string): string {
  const domain = address.split("@").at(-1)?.trim().toLowerCase();

  return domain === undefined || domain.length === 0 ? "unknown" : domain;
}

export type MailerDeps = {
  readonly transport: () => MailTransport;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
  readonly now: () => number;
};

const defaultDeps: MailerDeps = {
  transport: getMailTransport,
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms).unref();
    }),
  random: Math.random,
  now: () => Date.now(),
};

export type MailSendContext = {
  readonly category: MailCategory;
};

export type Mailer = {
  send(mail: OutboundMail, context: MailSendContext): Promise<MailSendResult>;
};

export function createMailer(overrides: Partial<MailerDeps> = {}): Mailer {
  const deps: MailerDeps = { ...defaultDeps, ...overrides };

  function backoffDelayMs(attempt: number): number {
    const exponential = MAIL_DELIVERY.retryBaseDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(exponential, MAIL_DELIVERY.retryMaxDelayMs);

    return Math.round(capped * (0.5 + deps.random() * 0.5));
  }

  async function send(
    mail: OutboundMail,
    context: MailSendContext,
  ): Promise<MailSendResult> {
    const transport = deps.transport();
    const domain = recipientDomain(mail.to);
    const startedAt = deps.now();

    let attempt = 0;

    for (;;) {
      attempt += 1;

      try {
        const result = await withTimeout(
          transport.send(mail),
          MAIL_DELIVERY.attemptTimeoutMs,
          "smtp send",
        );

        log.debug(
          {
            event: MAIL_EVENTS.delivered,
            category: context.category,
            transport: transport.kind,
            recipientDomain: domain,
            messageId: result.messageId,
            accepted: result.accepted,
            rejected: result.rejected,
            attempt,
            durationMs: deps.now() - startedAt,
          },
          "mail accepted by the transport",
        );

        return result;
      } catch (error) {
        const reason = classifyMailFailure(error);
        const exhausted = attempt >= MAIL_DELIVERY.maxAttempts;

        if (reason === "permanent" || exhausted) {
          log.warn(
            {
              err: error,
              event: MAIL_EVENTS.deliveryFailed,
              category: context.category,
              transport: transport.kind,
              recipientDomain: domain,
              reason,
              attempts: attempt,
              durationMs: deps.now() - startedAt,
            },
            "mail delivery failed",
          );

          throw new MailDeliveryError({
            reason,
            attempts: attempt,
            category: context.category,
            cause: error,
          });
        }

        const delayMs = backoffDelayMs(attempt);

        log.warn(
          {
            err: error,
            event: MAIL_EVENTS.deliveryRetrying,
            category: context.category,
            transport: transport.kind,
            recipientDomain: domain,
            attempt,
            delayMs,
          },
          "mail delivery failed — retrying",
        );

        await deps.sleep(delayMs);
      }
    }
  }

  return { send };
}

export const mailer = createMailer();

export async function sendMail(
  mail: OutboundMail,
  context: MailSendContext,
): Promise<MailSendResult> {
  return mailer.send(mail, context);
}
