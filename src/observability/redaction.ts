export const REDACTED = "[redacted]";

const CREDENTIAL_KEYS = [
  "authorization",
  "proxyAuthorization",
  "cookie",
  "setCookie",
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "passwordConfirmation",
  "token",
  "tokenHash",
  "accessToken",
  "refreshToken",
  "idToken",
  "sessionToken",
  "bearerToken",
  "apiKey",
  "secret",
  "clientSecret",
  "totpSecret",
  "mfaSecret",
  "recoveryCode",
  "recoveryCodes",
  "otp",
  "otpCode",
  "verificationCode",
  "emailVerificationCode",
  "assertion",
  "samlResponse",
  "privateKey",
  "signingKey",
  "credential",
  "credentials",
  "connectionString",
  "databaseUrl",
  "redisUrl",
  "dsn",
] as const;

const CONTEXTUAL_SECRET_KEYS = ["code", "hash", "value"] as const;

const SECRET_CONTAINERS = [
  "body",
  "req.body",
  "request.body",
  "query",
  "req.query",
  "params",
  "req.params",
  "payload",
  "input",
  "data",
  "before",
  "after",
  "changes",
] as const;

const EXPLICIT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["proxy-authorization"]',
  'req.headers["x-api-key"]',
  "request.headers.authorization",
  "request.headers.cookie",
  'res.headers["set-cookie"]',
  'response.headers["set-cookie"]',
  "command.args",
  "*.command.args",
  "err.command.args",
  "error.command.args",
  "err.query",
  "err.parameters",
  "error.query",
  "error.parameters",
] as const;

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`);
}

function buildRedactPaths(): readonly string[] {
  const paths = new Set<string>(EXPLICIT_PATHS);

  for (const key of CREDENTIAL_KEYS) {
    for (const variant of new Set([key, toSnakeCase(key)])) {
      paths.add(variant);
      paths.add(`*.${variant}`);

      for (const container of SECRET_CONTAINERS) {
        paths.add(`${container}.${variant}`);
      }
    }
  }

  for (const key of CONTEXTUAL_SECRET_KEYS) {
    for (const container of SECRET_CONTAINERS) {
      paths.add(`${container}.${key}`);
      paths.add(`${container}.${toSnakeCase(key)}`);
    }
  }

  return Object.freeze([...paths]);
}

export const REDACT_PATHS = buildRedactPaths();

export const LOGGABLE_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "content-type",
  "content-length",
  "host",
  "user-agent",
  "referer",
  "origin",
  "x-request-id",
  "x-correlation-id",
  "traceparent",
  "tracestate",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "idempotency-key",
  "if-match",
  "if-none-match",
]);

export const LOGGABLE_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "content-type",
  "content-length",
  "cache-control",
  "etag",
  "location",
  "retry-after",
  "x-request-id",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
]);

export const URL_VALUED_HEADERS: ReadonlySet<string> = new Set([
  "referer",
  "location",
]);

const UNSAFE_ERROR_FIELDS = [
  "query",
  "parameters",
  "params",
  "args",
  "arguments",
  "body",
  "payload",
  "headers",
  "config",
  "request",
  "response",
  "input",
  "values",
  "row",
  "rows",
  "detail",
  "where",
  "internalQuery",
] as const;

export function normalizeLogKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

const UNSAFE_LOG_KEYS: ReadonlySet<string> = new Set(
  [...CREDENTIAL_KEYS, ...CONTEXTUAL_SECRET_KEYS, ...UNSAFE_ERROR_FIELDS].map(
    normalizeLogKey,
  ),
);

export function isUnsafeLogKey(key: string): boolean {
  return UNSAFE_LOG_KEYS.has(normalizeLogKey(key));
}

const MAX_LOGGED_STRING = 512;

export function truncate(
  value: string,
  max: number = MAX_LOGGED_STRING,
): string {
  return value.length <= max ? value : `${value.slice(0, max)}…[truncated]`;
}

const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const OPAQUE_SEGMENT = /^[A-Za-z0-9._~+/-]{20,}$/u;

const MAX_LOGGED_QUERY_PARAMS = 20;

function sanitizePathSegment(segment: string): string {
  if (UUID_SEGMENT.test(segment) || !OPAQUE_SEGMENT.test(segment)) {
    return segment;
  }

  return REDACTED;
}

export function sanitizeUrl(url: string): string {
  const withoutFragment = url.split("#", 1)[0] ?? "";
  const separator = withoutFragment.indexOf("?");
  const rawPath =
    separator === -1 ? withoutFragment : withoutFragment.slice(0, separator);
  const rawQuery = separator === -1 ? "" : withoutFragment.slice(separator + 1);

  const path = rawPath.split("/").map(sanitizePathSegment).join("/");

  if (rawQuery.length === 0) {
    return truncate(path);
  }

  const parameters = rawQuery
    .split("&")
    .slice(0, MAX_LOGGED_QUERY_PARAMS)
    .map((pair) => {
      const name = pair.split("=", 1)[0] ?? "";
      return name.length === 0 ? REDACTED : `${name}=${REDACTED}`;
    });

  return truncate(`${path}?${parameters.join("&")}`);
}
