import { z } from "zod";
import {
  composePostgresUrl,
  composeRedactedPostgresUrl,
  DATABASE_SSL_MODES,
  type PostgresConnectionParts,
} from "./database-url.ts";
import {
  composeRedactedRedisUrl,
  composeRedisUrl,
  REDIS_TLS_MODES,
  type RedisConnectionParts,
} from "./redis-url.ts";
import {
  composeRedactedSmtpUrl,
  inspectMailConfiguration,
  MAIL_TRANSPORT_VALUES,
  resolveMailTransport,
  SMTP_SECURITY_MODES,
  type MailConfigurationWarning,
  type MailIdentity,
  type MailTransportKind,
  type SmtpConnectionParts,
} from "./smtp.ts";

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .default("")
  .refine(
    (value) => value.length === 0 || z.email().safeParse(value).success,
    "must be a valid email address, or empty",
  );

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

const headerSafeText = z
  .string()
  .trim()
  .max(78)
  .refine(
    (value) => !CONTROL_CHARACTERS.test(value),
    "must not contain control characters — they would break out of the mail header",
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().min(1).default("0.0.0.0"),
  SERVICE_NAME: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, "must be lowercase kebab-case")
    .default("identity-service"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: z.enum(DATABASE_SSL_MODES).default("disable"),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_USERNAME: z.string().default(""),
  REDIS_PASSWORD: z.string().default(""),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_TLS: z.enum(REDIS_TLS_MODES).default("disable"),
  JWT_ISSUER: z.string().min(1).max(255),
  JWT_AUDIENCE: z.string().min(1).max(255),
  JWT_SIGNING_KEY: z.string().min(1),
  JWT_SIGNING_KEY_ID: z
    .string()
    .max(128)
    .default("")
    .transform((value) => (value.length === 0 ? undefined : value)),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(900)
    .default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3_600)
    .max(90 * 24 * 60 * 60)
    .default(30 * 24 * 60 * 60),
  TRUST_PROXY: z
    .string()
    .default("1")
    .refine(
      (value) => !["true", "false"].includes(value.trim().toLowerCase()),
      "must be a hop count or a CIDR list, never a boolean — see src/config/env.ts",
    )
    .refine((value) => {
      const trimmed = value.trim();
      if (/^\d+$/u.test(trimmed)) {
        return Number(trimmed) >= 1 && Number(trimmed) <= 10;
      }
      return trimmed.split(",").every((entry) => entry.trim().length > 0);
    }, "must be an integer hop count between 1 and 10, or a comma-separated IP/CIDR list"),

  CORS_ALLOWED_ORIGINS: z.string().default(""),
  SWAGGER_UI_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(1_048_576)
    .default(65_536),
  REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(15_000),

  WEB_APP_BASE_URL: z.url().default("http://localhost:3000"),

  MAIL_TRANSPORT: z.enum(MAIL_TRANSPORT_VALUES).default(""),
  MAIL_FROM_ADDRESS: optionalEmail,
  MAIL_FROM_NAME: headerSafeText.default("Marketing Dashboard"),
  MAIL_REPLY_TO_ADDRESS: optionalEmail,
  SMTP_HOST: z.string().trim().max(255).default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURITY: z.enum(SMTP_SECURITY_MODES).default("starttls"),
  SMTP_USERNAME: z.string().trim().default(""),
  SMTP_PASSWORD: z.string().trim().default(""),
});

const parsed = envSchema
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && value.REDIS_PASSWORD.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_PASSWORD"],
        message:
          "must be set when NODE_ENV=production — an unauthenticated Redis is not acceptable here",
      });
    }

    const mailTransport = resolveMailTransport(
      value.MAIL_TRANSPORT,
      value.NODE_ENV,
    );

    if (value.NODE_ENV === "production" && mailTransport !== "smtp") {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_TRANSPORT"],
        message:
          "must be `smtp` when NODE_ENV=production — `console` writes a live verification code to the log pipeline and `noop` drops it, and either way sign-up can never complete",
      });
    }

    if (mailTransport === "smtp") {
      if (value.SMTP_HOST.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_HOST"],
          message: "must be set when MAIL_TRANSPORT=smtp",
        });
      }

      if (value.MAIL_FROM_ADDRESS.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["MAIL_FROM_ADDRESS"],
          message:
            "must be set when MAIL_TRANSPORT=smtp — a relay with no envelope sender is rejected or silently spam-filed",
        });
      }

      if (
        value.NODE_ENV === "production" &&
        value.SMTP_SECURITY === "disable"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_SECURITY"],
          message:
            "must be `starttls` or `implicit-tls` when NODE_ENV=production — `disable` sends SMTP AUTH credentials and every verification code in the clear",
        });
      }
    }

    const hasUsername = value.SMTP_USERNAME.length > 0;
    const hasPassword = value.SMTP_PASSWORD.length > 0;

    if (hasUsername !== hasPassword) {
      ctx.addIssue({
        code: "custom",
        path: [hasUsername ? "SMTP_PASSWORD" : "SMTP_USERNAME"],
        message:
          "SMTP_USERNAME and SMTP_PASSWORD are set together or not at all — a half-configured login fails at the first send, not at boot",
      });
    }

    if (
      mailTransport === "smtp" &&
      hasPassword &&
      value.SMTP_SECURITY === "disable"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_SECURITY"],
        message:
          "cannot be `disable` while SMTP_USERNAME/SMTP_PASSWORD are set — that transmits the relay credential unencrypted. Use `starttls` (usually port 587) or `implicit-tls` (usually port 465)",
      });
    }

    if (
      value.NODE_ENV === "production" &&
      !value.WEB_APP_BASE_URL.startsWith("https://")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["WEB_APP_BASE_URL"],
        message:
          "must be https when NODE_ENV=production — it is rendered as a link in outbound identity email",
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  process.stderr.write(
    `Invalid environment configuration. Refusing to start.\n${issues}\n` +
      `See .env.example for the expected shape.\n`,
  );
  process.exit(1);
}

export const env = parsed.data;

export type Env = typeof env;

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

export const databaseConnection: PostgresConnectionParts = {
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  database: env.DATABASE_NAME,
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  sslMode: env.DATABASE_SSL,
};

export const databaseUrl = composePostgresUrl(databaseConnection);

export const databaseUrlRedacted =
  composeRedactedPostgresUrl(databaseConnection);

export const redisConnection: RedisConnectionParts = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  username: env.REDIS_USERNAME,
  password: env.REDIS_PASSWORD,
  db: env.REDIS_DB,
  tls: env.REDIS_TLS,
};

export const redisUrl = composeRedisUrl(redisConnection);

export const redisUrlRedacted = composeRedactedRedisUrl(redisConnection);

export const smtpConnection: SmtpConnectionParts = {
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  username: env.SMTP_USERNAME,
  password: env.SMTP_PASSWORD,
  security: env.SMTP_SECURITY,
};

export const smtpTargetRedacted = composeRedactedSmtpUrl(smtpConnection);

export const mailTransportKind: MailTransportKind = resolveMailTransport(
  env.MAIL_TRANSPORT,
  env.NODE_ENV,
);

export const mailIdentity: MailIdentity = {
  fromAddress: env.MAIL_FROM_ADDRESS,
  fromName: env.MAIL_FROM_NAME,
  replyToAddress: env.MAIL_REPLY_TO_ADDRESS,
};

export const mailConfigurationWarnings: readonly MailConfigurationWarning[] =
  inspectMailConfiguration({
    transport: mailTransportKind,
    smtp: smtpConnection,
    identity: mailIdentity,
  });

export const trustProxy: number | string[] = /^\d+$/u.test(
  env.TRUST_PROXY.trim(),
)
  ? Number(env.TRUST_PROXY.trim())
  : env.TRUST_PROXY.split(",").map((entry) => entry.trim());

export const corsAllowedOrigins: readonly string[] =
  env.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
