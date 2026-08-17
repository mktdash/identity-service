import { formatUrlHost } from "./url-authority.ts";

export const DATABASE_SSL_MODES = [
  "disable",
  "require",
  "verify-full",
] as const;

export type DatabaseSslMode = (typeof DATABASE_SSL_MODES)[number];

export type PostgresConnectionParts = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: DatabaseSslMode;
};

export function toPostgresSslOption(
  mode: DatabaseSslMode,
): false | "require" | "verify-full" {
  return mode === "disable" ? false : mode;
}

function build(parts: PostgresConnectionParts, password: string): string {
  const user = encodeURIComponent(parts.user);
  const database = encodeURIComponent(parts.database);
  const host = formatUrlHost(parts.host);
  const query = parts.sslMode === "disable" ? "" : `?sslmode=${parts.sslMode}`;
  return `postgres://${user}:${password}@${host}:${parts.port}/${database}${query}`;
}

export function composePostgresUrl(parts: PostgresConnectionParts): string {
  return build(parts, encodeURIComponent(parts.password));
}

export function composeRedactedPostgresUrl(
  parts: PostgresConnectionParts,
): string {
  return build(parts, "[redacted]");
}
