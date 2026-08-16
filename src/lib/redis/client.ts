import { Redis } from "ioredis";
import { redisConnection } from "../../config/env.ts";
import {
  toRedisAuthOptions,
  toRedisTlsOptions,
} from "../../config/redis-url.ts";
import { logger } from "../../observability/logger.ts";

const log = logger.child({ component: "redis" });
const auth = toRedisAuthOptions(redisConnection);
const tls = toRedisTlsOptions(redisConnection.tls);

export const REDIS_COMMAND_TIMEOUT_MS = 250;

const DEGRADED_LOG_INTERVAL_MS = 1_000;

export const REDIS_EVENTS = {
  connectionError: "redis_connection_error",
  connectionClosed: "redis_connection_closed",
  degraded: "redis_degraded",
  recovered: "redis_recovered",
} as const;

export type RedisFailurePolicy = "fail-open" | "fail-closed";

export const REDIS_FAILURE_POLICIES = {
  permissionVersion: "fail-open",
  sessionDenylist: "fail-open",
  authRateLimit: "fail-open",
  loginThrottle: "fail-closed",
  oneTimeCode: "fail-closed",
} as const satisfies Record<string, RedisFailurePolicy>;

export type RedisUseCase = keyof typeof REDIS_FAILURE_POLICIES;

export const redis = new Redis({
  host: redisConnection.host,
  port: redisConnection.port,
  db: redisConnection.db,
  ...auth,
  ...(tls === false ? {} : { tls }),
  connectionName: "identity-service",
  lazyConnect: true,
  connectTimeout: 5_000,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 2_000),
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
});

export type RedisUnavailableReason =
  | "disconnected"
  | "timeout"
  | "server_unavailable";

export type RedisUnavailable = {
  readonly outcome: "unavailable";
  readonly reason: RedisUnavailableReason;
  readonly useCase: RedisUseCase;
  readonly operation: string;
  readonly cause: Error;
};

export type RedisReadResult<TValue> =
  | { readonly outcome: "hit"; readonly value: TValue }
  | { readonly outcome: "miss" }
  | RedisUnavailable;

export type RedisResult<TValue> =
  | { readonly outcome: "ok"; readonly value: TValue }
  | RedisUnavailable;

export class RedisUnavailableError extends Error {
  readonly useCase: RedisUseCase;
  readonly operation: string;
  readonly reason: RedisUnavailableReason;

  constructor(failure: RedisUnavailable) {
    super(
      `Redis unavailable (${failure.reason}) during ${failure.operation}; ` +
        `${failure.useCase} is fail-closed`,
      { cause: failure.cause },
    );
    this.name = "RedisUnavailableError";
    this.useCase = failure.useCase;
    this.operation = failure.operation;
    this.reason = failure.reason;
  }
}

const UNAVAILABLE_SOCKET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

const UNAVAILABLE_REPLY_PREFIXES = [
  "LOADING",
  "BUSY",
  "CLUSTERDOWN",
  "MASTERDOWN",
  "TRYAGAIN",
  "OOM",
];

function socketErrorCode(error: Error): string | undefined {
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function classifyRedisFailure(
  error: unknown,
): RedisUnavailableReason | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message === "Command timed out") {
    return "timeout";
  }

  if (
    error.message.startsWith("Stream isn't writeable") ||
    error.message === "Connection is closed." ||
    error.name === "AbortError" ||
    error.name === "MaxRetriesPerRequestError" ||
    error.name === "ClusterAllFailedError"
  ) {
    return "disconnected";
  }

  const code = socketErrorCode(error);
  if (code !== undefined && UNAVAILABLE_SOCKET_CODES.has(code)) {
    return "disconnected";
  }

  if (
    error.name === "ReplyError" &&
    UNAVAILABLE_REPLY_PREFIXES.some((prefix) =>
      error.message.startsWith(prefix),
    )
  ) {
    return "server_unavailable";
  }

  return null;
}

let degradedLoggedAt = 0;
let degradedSuppressed = 0;
let degradedSinceLastReady = false;

function logDegraded(failure: RedisUnavailable): void {
  degradedSinceLastReady = true;

  const now = Date.now();
  if (
    degradedLoggedAt !== 0 &&
    now - degradedLoggedAt < DEGRADED_LOG_INTERVAL_MS
  ) {
    degradedSuppressed += 1;
    return;
  }

  const suppressed = degradedSuppressed;
  degradedLoggedAt = now;
  degradedSuppressed = 0;

  log.warn(
    {
      event: REDIS_EVENTS.degraded,
      useCase: failure.useCase,
      operation: failure.operation,
      reason: failure.reason,
      policy: REDIS_FAILURE_POLICIES[failure.useCase],
      suppressed,
      err: failure.cause,
    },
    "redis unavailable — degraded mode",
  );
}

type Executed<TValue> =
  | { readonly resolved: true; readonly value: TValue }
  | { readonly resolved: false; readonly failure: RedisUnavailable };

async function execute<TValue>(
  useCase: RedisUseCase,
  operation: string,
  run: (client: Redis) => Promise<TValue>,
): Promise<Executed<TValue>> {
  try {
    return { resolved: true, value: await run(redis) };
  } catch (error) {
    const reason = classifyRedisFailure(error);
    if (reason === null) {
      throw error;
    }

    const failure: RedisUnavailable = {
      outcome: "unavailable",
      reason,
      useCase,
      operation,
      cause: error instanceof Error ? error : new Error(String(error)),
    };

    logDegraded(failure);

    if (REDIS_FAILURE_POLICIES[useCase] === "fail-closed") {
      throw new RedisUnavailableError(failure);
    }

    return { resolved: false, failure };
  }
}

export async function redisRead<TValue>(
  useCase: RedisUseCase,
  operation: string,
  run: (client: Redis) => Promise<TValue | null>,
): Promise<RedisReadResult<TValue>> {
  const executed = await execute(useCase, operation, run);
  if (!executed.resolved) {
    return executed.failure;
  }

  if (executed.value === null) {
    return { outcome: "miss" };
  }

  return { outcome: "hit", value: executed.value };
}

export async function redisExec<TValue>(
  useCase: RedisUseCase,
  operation: string,
  run: (client: Redis) => Promise<TValue>,
): Promise<RedisResult<TValue>> {
  const executed = await execute(useCase, operation, run);
  return executed.resolved
    ? { outcome: "ok", value: executed.value }
    : executed.failure;
}

redis.on("error", (error: Error) => {
  log.error(
    { err: error, event: REDIS_EVENTS.connectionError },
    "redis connection error",
  );
});

redis.on("end", () => {
  log.warn({ event: REDIS_EVENTS.connectionClosed }, "redis connection closed");
});

redis.on("ready", () => {
  if (!degradedSinceLastReady) {
    return;
  }

  degradedSinceLastReady = false;
  const suppressed = degradedSuppressed;
  degradedSuppressed = 0;
  degradedLoggedAt = 0;

  log.info(
    { event: REDIS_EVENTS.recovered, suppressed },
    "redis reconnected — degraded mode ended",
  );
});

export async function connectRedis(): Promise<void> {
  if (redis.status === "wait") {
    await redis.connect();
  }
}

export type RedisConnectionInfo = {
  serverVersion: string;
};

export async function checkRedisConnection(): Promise<RedisConnectionInfo> {
  const pong = await redis.ping();
  if (pong !== "PONG") {
    throw new Error(`Unexpected PING reply from Redis: ${pong}`);
  }

  const info = await redis.info("server");
  const serverVersion =
    /^redis_version:(.+)$/m.exec(info)?.[1]?.trim() ?? "unknown";

  return { serverVersion };
}

export async function closeRedis(): Promise<void> {
  if (redis.status === "end") {
    return;
  }

  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
