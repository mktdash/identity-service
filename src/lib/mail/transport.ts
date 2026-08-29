import { createTransport, type Transporter } from "nodemailer";
import { MAIL_EVENTS, SMTP_POOL } from "#config/constants";
import {
  mailIdentity,
  mailTransportKind,
  smtpConnection,
  smtpTargetRedacted,
} from "#config/env";
import {
  formatMailAddress,
  toSmtpTransportOptions,
  type MailTransportKind,
} from "#config/smtp";
import { logger } from "#observability/logger";

const log = logger.child({ component: "mail" });

export type OutboundMail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
};

export type MailSendResult = {
  readonly messageId: string;
  readonly accepted: number;
  readonly rejected: number;
};

export type MailTransport = {
  readonly kind: MailTransportKind;
  readonly target: string;
  send(mail: OutboundMail): Promise<MailSendResult>;
  verify(): Promise<void>;
  close(): Promise<void>;
};

function countRecipients(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildMessage(mail: OutboundMail) {
  const replyTo = mailIdentity.replyToAddress;

  return {
    from: formatMailAddress(mailIdentity),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: { ...mail.headers },
    envelope: { from: mailIdentity.fromAddress, to: [mail.to] },
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(replyTo.length === 0 ? {} : { replyTo }),
  };
}

function createSmtpTransport(): MailTransport {
  const transporter: Transporter = createTransport(
    toSmtpTransportOptions(smtpConnection, SMTP_POOL),
  );

  transporter.on("error", (error: Error) => {
    log.error(
      { err: error, event: MAIL_EVENTS.transportUnavailable },
      "smtp pool error",
    );
  });

  return {
    kind: "smtp",
    target: smtpTargetRedacted,

    async send(mail) {
      const info: unknown = await transporter.sendMail(buildMessage(mail));
      const record = (info ?? {}) as Record<string, unknown>;
      const messageId = record["messageId"];

      return {
        messageId: typeof messageId === "string" ? messageId : "",
        accepted: countRecipients(record["accepted"]),
        rejected: countRecipients(record["rejected"]),
      };
    },

    async verify() {
      await transporter.verify();
    },

    async close() {
      transporter.close();
      await Promise.resolve();
    },
  };
}

function createConsoleTransport(): MailTransport {
  let sequence = 0;

  return {
    kind: "console",
    target: "(stdout)",

    async send(mail) {
      sequence += 1;
      const messageId = `<console-${String(sequence)}@identity-service.local>`;

      process.stdout.write(
        `\n┌─ DEV EMAIL ─────────────────────────────────────────────────\n` +
          `│ to      : ${mail.to}\n` +
          `│ from    : ${formatMailAddress(mailIdentity)}\n` +
          `│ subject : ${mail.subject}\n` +
          `├─────────────────────────────────────────────────────────────\n` +
          `${mail.text.replace(/^/gmu, "│ ")}\n` +
          `└─────────────────────────────────────────────────────────────\n\n`,
      );

      await Promise.resolve();

      return { messageId, accepted: 1, rejected: 0 };
    },

    async verify() {
      await Promise.resolve();
    },

    async close() {
      await Promise.resolve();
    },
  };
}

function createNoopTransport(): MailTransport {
  return {
    kind: "noop",
    target: "(discarded)",

    async send() {
      await Promise.resolve();
      return { messageId: "", accepted: 0, rejected: 0 };
    },

    async verify() {
      await Promise.resolve();
    },

    async close() {
      await Promise.resolve();
    },
  };
}

export function createMailTransport(
  kind: MailTransportKind = mailTransportKind,
): MailTransport {
  switch (kind) {
    case "smtp":
      return createSmtpTransport();
    case "console":
      return createConsoleTransport();
    case "noop":
      return createNoopTransport();
  }
}

let instance: MailTransport | undefined;

export function getMailTransport(): MailTransport {
  instance ??= createMailTransport();
  return instance;
}

export type MailTransportStatus = {
  readonly kind: MailTransportKind;
  readonly target: string;
};

export async function verifyMailTransport(): Promise<MailTransportStatus> {
  const transport = getMailTransport();
  await transport.verify();

  return { kind: transport.kind, target: transport.target };
}

export async function closeMailTransport(): Promise<void> {
  if (instance === undefined) {
    return;
  }

  const transport = instance;
  instance = undefined;
  await transport.close();

  log.info(
    { event: MAIL_EVENTS.transportClosed, transport: transport.kind },
    "mail transport closed",
  );
}
