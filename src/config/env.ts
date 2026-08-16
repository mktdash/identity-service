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
