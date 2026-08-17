import {
  isUnsafeLogKey,
  LOGGABLE_REQUEST_HEADERS,
  LOGGABLE_RESPONSE_HEADERS,
  normalizeLogKey,
  sanitizeUrl,
  truncate,
  URL_VALUED_HEADERS,
} from "./redaction.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

const MAX_LOGGED_HEADER = 256;

function formatHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string").join(", ");
  }

  return undefined;
}

function serializeHeaders(
  source: unknown,
  allowed: ReadonlySet<string>,
): Record<string, string> | undefined {
  const headers = asRecord(source);
  if (headers === undefined) {
    return undefined;
  }

  const result: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!allowed.has(name)) {
      continue;
    }

    const value = formatHeaderValue(rawValue);
    if (value === undefined || value.length === 0) {
      continue;
    }

    result[name] = URL_VALUED_HEADERS.has(name)
      ? sanitizeUrl(value)
      : truncate(value, MAX_LOGGED_HEADER);
  }

  return Object.keys(result).length === 0 ? undefined : result;
}

export type SerializedRequest = {
  id?: string;
  method?: string;
  route?: string;
  url?: string;
  remoteAddress?: string;
  remotePort?: number;
  headers?: Record<string, string>;
};

export function requestSerializer(request: unknown): SerializedRequest {
  const source = asRecord(request);
  if (source === undefined) {
    return {};
  }

  const result: SerializedRequest = {};

  const id = source["id"];
  if (typeof id === "string" || typeof id === "number") {
    result.id = String(id);
  }

  const method = asString(source["method"]);
  if (method !== undefined) {
    result.method = method;
  }

  const route = asString(asRecord(source["routeOptions"])?.["url"]);
  if (route !== undefined) {
    result.route = route;
  }

  const url =
    asString(source["url"]) ?? asString(asRecord(source["raw"])?.["url"]);
  if (url !== undefined) {
    result.url = sanitizeUrl(url);
  }

  const remoteAddress =
    asString(source["ip"]) ??
    asString(asRecord(source["socket"])?.["remoteAddress"]);
  if (remoteAddress !== undefined) {
    result.remoteAddress = remoteAddress;
  }

  const remotePort = asNumber(asRecord(source["socket"])?.["remotePort"]);
  if (remotePort !== undefined) {
    result.remotePort = remotePort;
  }

  const headers = serializeHeaders(source["headers"], LOGGABLE_REQUEST_HEADERS);
  if (headers !== undefined) {
    result.headers = headers;
  }

  return result;
}

export type SerializedResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
};

export function responseSerializer(reply: unknown): SerializedResponse {
  const source = asRecord(reply);
  if (source === undefined) {
    return {};
  }

  const result: SerializedResponse = {};

  const statusCode = asNumber(source["statusCode"]);
  if (statusCode !== undefined) {
    result.statusCode = statusCode;
  }

  const getHeaders = source["getHeaders"];
  const rawHeaders =
    typeof getHeaders === "function"
      ? (getHeaders as (this: unknown) => unknown).call(reply)
      : source["headers"];

  const headers = serializeHeaders(rawHeaders, LOGGABLE_RESPONSE_HEADERS);
  if (headers !== undefined) {
    result.headers = headers;
  }

  return result;
}

export type SerializedError = {
  type: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
  [field: string]: unknown;
};

const ERROR_FIELD_ALLOWLIST: ReadonlySet<string> = new Set(
  [
    "code",
    "errno",
    "syscall",
    "statusCode",
    "status",
    "severity",
    "constraint",
    "constraintName",
    "table",
    "column",
    "schema",
    "routine",
    "reason",
    "operation",
    "useCase",
    "policy",
    "expected",
    "received",
  ].map(normalizeLogKey),
);

const MAX_CAUSE_DEPTH = 4;

function serializeErrorField(value: unknown): unknown {
  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return undefined;
}

function serialize(
  input: unknown,
  depth: number,
  seen: Set<unknown>,
): SerializedError {
  if (!(input instanceof Error)) {
    return {
      type: input === null ? "null" : typeof input,
      message: truncate(String(input)),
    };
  }

  const result: SerializedError = {
    type: input.constructor.name,
    message: truncate(input.message),
  };

  if (typeof input.stack === "string") {
    result.stack = input.stack;
  }

  for (const key of Object.keys(input)) {
    if (key === "message" || key === "stack" || key === "cause") {
      continue;
    }

    const allowed = ERROR_FIELD_ALLOWLIST.has(normalizeLogKey(key));
    if (!allowed && isUnsafeLogKey(key)) {
      continue;
    }

    const value = serializeErrorField(
      (input as unknown as Record<string, unknown>)[key],
    );
    if (value !== undefined) {
      result[key] = value;
    }
  }

  const command = asRecord(
    (input as unknown as Record<string, unknown>)["command"],
  );
  const commandName = asString(command?.["name"]);
  if (commandName !== undefined) {
    result["command"] = { name: commandName };
  }

  const { cause } = input;
  if (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH) {
    if (!seen.has(cause)) {
      seen.add(cause);
      result.cause = serialize(cause, depth + 1, seen);
    }
  }

  return result;
}

export function errorSerializer(error: unknown): SerializedError {
  return serialize(error, 0, new Set([error]));
}

export const serializers = {
  req: requestSerializer,
  request: requestSerializer,
  res: responseSerializer,
  response: responseSerializer,
  err: errorSerializer,
  error: errorSerializer,
} as const;
