import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { toPostgresSslOption } from "../config/database-url.ts";
import { databaseConnection, env } from "../config/env.ts";
import { logger } from "../observability/logger.ts";

const log = logger.child({ component: "db" });

export const sql = postgres({
  host: databaseConnection.host,
  port: databaseConnection.port,
  database: databaseConnection.database,
  user: databaseConnection.user,
  password: databaseConnection.password,
  ssl: toPostgresSslOption(databaseConnection.sslMode),
  max: env.DATABASE_POOL_MAX,
  idle_timeout: 30,
  max_lifetime: 60 * 30,
  connect_timeout: 10,
  onnotice: (notice) => {
    log.debug(
      { severity: notice.severity, message: notice.message },
      "postgres notice",
    );
  },
});

export const db = drizzle(sql, { logger: false });

export type Database = typeof db;

type ConnectionInfoRow = {
  server_version: string;
  connected_user: string;
  connected_database: string;
  is_superuser: boolean;
  can_bypass_rls: boolean;
};

export type DatabaseConnectionInfo = {
  serverVersion: string;
  user: string;
  database: string;
  isSuperuser: boolean;
  canBypassRls: boolean;
};

export async function checkDatabaseConnection(): Promise<DatabaseConnectionInfo> {
  const rows = await sql<ConnectionInfoRow[]>`
    select
      current_setting('server_version') as server_version,
      current_user::text                as connected_user,
      current_database()::text          as connected_database,
      coalesce(r.rolsuper, false)       as is_superuser,
      coalesce(r.rolbypassrls, false)   as can_bypass_rls
    from pg_roles r
    where r.rolname = current_user
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Database connectivity check returned no rows");
  }

  return {
    serverVersion: row.server_version,
    user: row.connected_user,
    database: row.connected_database,
    isSuperuser: row.is_superuser,
    canBypassRls: row.can_bypass_rls,
  };
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
