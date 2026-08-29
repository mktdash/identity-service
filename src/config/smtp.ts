import type { ConnectionOptions } from "node:tls";
import { formatUrlHost } from "./url-authority.ts";

export const MAIL_TRANSPORTS = ["smtp", "console", "noop"] as const;

export type MailTransportKind = (typeof MAIL_TRANSPORTS)[number];

export const MAIL_TRANSPORT_VALUES = [...MAIL_TRANSPORTS, ""] as const;

export const SMTP_SECURITY_MODES = [
  "implicit-tls",
  "starttls",
  "disable",
] as const;

export type SmtpSecurityMode = (typeof SMTP_SECURITY_MODES)[number];

export type SmtpConnectionParts = {
  host: string;
  port: number;
  username: string;
  password: string;
  security: SmtpSecurityMode;
};

export type SmtpTuning = {
  maxConnections: number;
  maxMessages: number;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
};

export type SmtpTransportOptions = {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly requireTLS: boolean;
  readonly ignoreTLS: boolean;
  readonly auth?: { readonly user: string; readonly pass: string };
  readonly tls?: ConnectionOptions;
  readonly pool: true;
  readonly maxConnections: number;
  readonly maxMessages: number;
  readonly connectionTimeout: number;
  readonly greetingTimeout: number;
  readonly socketTimeout: number;
  readonly disableFileAccess: true;
  readonly disableUrlAccess: true;
};

export function resolveMailTransport(
  configured: MailTransportKind | "",
  nodeEnv: "development" | "test" | "production",
): MailTransportKind {
  if (configured !== "") {
    return configured;
  }

  return nodeEnv === "test" ? "noop" : "console";
}

export type SmtpSecurityOptions = {
  readonly secure: boolean;
  readonly requireTLS: boolean;
  readonly ignoreTLS: boolean;
};

export function toSmtpSecurityOptions(
  mode: SmtpSecurityMode,
): SmtpSecurityOptions {
  switch (mode) {
    case "implicit-tls":
      return { secure: true, requireTLS: false, ignoreTLS: false };
    case "starttls":
      return { secure: false, requireTLS: true, ignoreTLS: false };
    case "disable":
      return { secure: false, requireTLS: false, ignoreTLS: true };
  }
}

export function toSmtpTlsOptions(
  mode: SmtpSecurityMode,
): ConnectionOptions | undefined {
  if (mode === "disable") {
    return undefined;
  }

  return { rejectUnauthorized: true, minVersion: "TLSv1.2" };
}

export type SmtpAuthOptions = { readonly user: string; readonly pass: string };

export function toSmtpAuthOptions(
  parts: SmtpConnectionParts,
): SmtpAuthOptions | undefined {
  if (parts.username.length === 0) {
    return undefined;
  }

  return { user: parts.username, pass: parts.password };
}

export function toSmtpTransportOptions(
  parts: SmtpConnectionParts,
  tuning: SmtpTuning,
): SmtpTransportOptions {
  const auth = toSmtpAuthOptions(parts);
  const tls = toSmtpTlsOptions(parts.security);

  return {
    host: parts.host,
    port: parts.port,
    ...toSmtpSecurityOptions(parts.security),
    ...(auth === undefined ? {} : { auth }),
    ...(tls === undefined ? {} : { tls }),
    pool: true,
    maxConnections: tuning.maxConnections,
    maxMessages: tuning.maxMessages,
    connectionTimeout: tuning.connectionTimeoutMs,
    greetingTimeout: tuning.greetingTimeoutMs,
    socketTimeout: tuning.socketTimeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function composeRedactedSmtpUrl(parts: SmtpConnectionParts): string {
  if (parts.host.length === 0) {
    return "(not configured)";
  }

  const scheme = parts.security === "implicit-tls" ? "smtps" : "smtp";
  const userInfo =
    parts.username.length === 0
      ? ""
      : `${encodeURIComponent(parts.username)}:[redacted]@`;

  return `${scheme}://${userInfo}${formatUrlHost(parts.host)}:${parts.port}`;
}

export type MailIdentity = {
  readonly fromAddress: string;
  readonly fromName: string;
  readonly replyToAddress: string;
};

export type MailConfigurationWarning = {
  readonly code: string;
  readonly message: string;
};

export function inspectMailConfiguration(input: {
  readonly transport: MailTransportKind;
  readonly smtp: SmtpConnectionParts;
  readonly identity: MailIdentity;
}): readonly MailConfigurationWarning[] {
  if (input.transport !== "smtp") {
    return [];
  }

  const warnings: MailConfigurationWarning[] = [];

  const sender = input.identity.fromAddress.trim().toLowerCase();
  const account = input.smtp.username.trim().toLowerCase();

  if (sender.length > 0 && account.length > 0 && sender !== account) {
    warnings.push({
      code: "sender_differs_from_smtp_account",
      message:
        "MAIL_FROM_ADDRESS differs from SMTP_USERNAME. Providers that enforce sender identity will rewrite the From header to the authenticated account, or reject the message, unless this address is registered with them as a verified sender or alias.",
    });
  }

  if (
    input.identity.replyToAddress.length === 0 &&
    sender.length > 0 &&
    !/^(?:no-?reply|do-?not-?reply)@/u.test(sender)
  ) {
    warnings.push({
      code: "sender_mailbox_is_unattended",
      message:
        "MAIL_FROM_ADDRESS is not a no-reply address and MAIL_REPLY_TO_ADDRESS is unset, so replies to identity email land in that mailbox with nobody reading them.",
    });
  }

  return warnings;
}

export function formatMailAddress(identity: MailIdentity): string {
  if (identity.fromAddress.length === 0) {
    return "(not configured)";
  }

  if (identity.fromName.length === 0) {
    return identity.fromAddress;
  }

  const escaped = identity.fromName.replaceAll(/[\\"]/gu, "\\$&");

  return `"${escaped}" <${identity.fromAddress}>`;
}
