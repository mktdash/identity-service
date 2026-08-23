import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { toPostgresSslOption } from "#config/database-url";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set. Seeds connect as the owning role ` +
        `(DATABASE_MIGRATION_USER / DATABASE_MIGRATION_PASSWORD), not the ` +
        `application role — see seed/lib/connection.ts.`,
    );
  }

  return value;
}

export function openSeedConnection() {
  const sql = postgres({
    host: required("DATABASE_HOST"),
    port: Number(process.env["DATABASE_PORT"] ?? 5432),
    database: required("DATABASE_NAME"),
    user: required("DATABASE_MIGRATION_USER"),
    password: required("DATABASE_MIGRATION_PASSWORD"),
    ssl: toPostgresSslOption(
      (process.env["DATABASE_SSL"] ?? "disable") as Parameters<
        typeof toPostgresSslOption
      >[0],
    ),
    max: 1,
    onnotice: () => undefined,
  });

  return {
    sql,
    db: drizzle(sql, { logger: false }),
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}
