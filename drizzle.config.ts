import { defineConfig } from "drizzle-kit";
import {
  DATABASE_SSL_MODES,
  toPostgresSslOption,
  type DatabaseSslMode,
} from "./src/config/database-url.ts";

const envFile = `.env.${process.env.NODE_ENV ?? "development"}`;

try {
  process.loadEnvFile(envFile);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to ${envFile} — drizzle-kit needs the owning role ` +
        `(DATABASE_MIGRATION_USER / DATABASE_MIGRATION_PASSWORD) plus the shared ` +
        `DATABASE_HOST / DATABASE_PORT / DATABASE_NAME, not the application role, because ` +
        `the application role cannot run DDL.`,
    );
  }

  return value;
}

function sslMode(): DatabaseSslMode {
  const value = process.env.DATABASE_SSL;

  if (!value) {
    return "disable";
  }

  if (!(DATABASE_SSL_MODES as readonly string[]).includes(value)) {
    throw new Error(
      `DATABASE_SSL must be one of: ${DATABASE_SSL_MODES.join(", ")}. Received "${value}".`,
    );
  }

  return value as DatabaseSslMode;
}

const port = Number(process.env.DATABASE_PORT ?? 5432);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(
    `DATABASE_PORT must be an integer between 1 and 65535. Received "${port}".`,
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    host: required("DATABASE_HOST"),
    port,
    database: required("DATABASE_NAME"),
    user: required("DATABASE_MIGRATION_USER"),
    password: required("DATABASE_MIGRATION_PASSWORD"),
    ssl: toPostgresSslOption(sslMode()),
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  breakpoints: true,
  verbose: true,
});
