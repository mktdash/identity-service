import type { ConnectionOptions } from "node:tls";
import { formatUrlHost } from "./url-authority.ts";

export const REDIS_TLS_MODES = ["disable", "verify-full"] as const;

export type RedisTlsMode = (typeof REDIS_TLS_MODES)[number];

export type RedisConnectionParts = {
  host: string;
  port: number;
  username: string;
  password: string;
  db: number;
  tls: RedisTlsMode;
};

export function toRedisTlsOptions(
  mode: RedisTlsMode,
): false | ConnectionOptions {
  if (mode === "disable") {
    return false;
  }

  return { rejectUnauthorized: true, minVersion: "TLSv1.2" };
}

export type RedisAuthOptions = {
  username?: string;
  password?: string;
};

export function toRedisAuthOptions(
  parts: RedisConnectionParts,
): RedisAuthOptions {
  if (parts.username) {
    return { username: parts.username, password: parts.password };
  }

  if (parts.password) {
    return { password: parts.password };
  }

  return {};
}

function buildUserInfo(parts: RedisConnectionParts, password: string): string {
  if (parts.username) {
    return `${encodeURIComponent(parts.username)}:${password}@`;
  }

  if (parts.password) {
    return `:${password}@`;
  }

  return "";
}

function build(parts: RedisConnectionParts, password: string): string {
  const scheme = parts.tls === "disable" ? "redis" : "rediss";
  const userInfo = buildUserInfo(parts, password);
  const host = formatUrlHost(parts.host);
  return `${scheme}://${userInfo}${host}:${parts.port}/${parts.db}`;
}

export function composeRedisUrl(parts: RedisConnectionParts): string {
  return build(parts, encodeURIComponent(parts.password));
}

export function composeRedactedRedisUrl(parts: RedisConnectionParts): string {
  return build(parts, "[redacted]");
}
