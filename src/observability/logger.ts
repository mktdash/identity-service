import {
  destination as pinoDestination,
  pino,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";
import { env, isDevelopment, isProduction, isTest } from "../config/env.ts";
import { REDACT_PATHS, REDACTED } from "./redaction.ts";
import { logCorrelation } from "./request-context.ts";
import { serializers } from "./serializers.ts";

export type CreateLoggerOptions = {
  level?: string;
  serviceName?: string;
  pretty?: boolean;
  destination?: DestinationStream;
  mixin?: () => Record<string, unknown>;
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const serviceName = options.serviceName ?? env.SERVICE_NAME;
  const pretty = isProduction ? false : (options.pretty ?? isDevelopment);

  const baseOptions: LoggerOptions = {
    level: options.level ?? env.LOG_LEVEL,
    base: { service: serviceName, environment: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACTED,
    },
    serializers,
    mixin: options.mixin ?? logCorrelation,
  };

  if (options.destination !== undefined) {
    return pino(baseOptions, options.destination);
  }

  if (pretty) {
    return pino({
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname,service,environment",
          singleLine: false,
        },
      },
    });
  }

  return pino(baseOptions);
}

const sharedDestination =
  isDevelopment || isTest
    ? undefined
    : pinoDestination({ dest: 1, sync: false, minLength: 4096 });

export const logger: Logger = createLogger(
  sharedDestination === undefined ? {} : { destination: sharedDestination },
);

if (sharedDestination !== undefined) {
  process.on("exit", () => {
    sharedDestination.flushSync();
  });
}

export async function flushLogger(): Promise<void> {
  if (sharedDestination === undefined) {
    return;
  }

  await new Promise<void>((resolve) => {
    sharedDestination.flush(() => {
      resolve();
    });
  });
}

export const LOG_RETENTION = {
  operational: "operational",
  security: "security",
} as const;

export type LogRetention = (typeof LOG_RETENTION)[keyof typeof LOG_RETENTION];

export const securityLogger: Logger = logger.child({
  retention: LOG_RETENTION.security,
});

export function withRetention(log: Logger, retention: LogRetention): Logger {
  return log.child({ retention });
}
