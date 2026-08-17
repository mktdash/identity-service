import closeWithGrace from "close-with-grace";
import { env } from "#config/env";
import { checkDatabaseConnection, closeDatabase } from "#db/client";
import {
  checkRedisConnection,
  closeRedis,
  connectRedis,
} from "#lib/redis/client";
import { flushLogger, logger } from "#observability/logger";

async function connectDependencies(): Promise<void> {
  const database = await checkDatabaseConnection();
  logger.info(
    {
      event: "database_connected",
      serverVersion: database.serverVersion,
      user: database.user,
      database: database.database,
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      ssl: env.DATABASE_SSL,
    },
    "postgres connected",
  );

  if (database.isSuperuser || database.canBypassRls) {
    logger.warn(
      {
        event: "database_role_bypasses_rls",
        user: database.user,
        isSuperuser: database.isSuperuser,
        canBypassRls: database.canBypassRls,
      },
      "connected role can bypass row-level security — every RLS policy is a no-op for this connection",
    );
  }

  await connectRedis();
  const redis = await checkRedisConnection();
  logger.info(
    {
      event: "redis_connected",
      serverVersion: redis.serverVersion,
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      username: env.REDIS_USERNAME || "(default)",
      db: env.REDIS_DB,
      tls: env.REDIS_TLS,
    },
    "redis connected",
  );
}

closeWithGrace({ delay: 10_000, logger }, async ({ err, signal, manual }) => {
  if (err) {
    logger.fatal(
      { err, event: "shutdown" },
      "shutting down after an unhandled error",
    );
  } else {
    logger.info({ event: "shutdown", signal, manual }, "shutting down");
  }

  await closeDatabase();
  await closeRedis();
  await flushLogger();
});

try {
  logger.info(
    { event: "startup", nodeEnv: env.NODE_ENV, nodeVersion: process.version },
    "starting identity-service",
  );

  await connectDependencies();

  logger.info(
    { event: "startup_complete", port: env.PORT, host: env.HOST },
    "dependencies connected — HTTP server not implemented yet (phase 1 spine)",
  );
} catch (error) {
  logger.fatal({ err: error, event: "startup_failed" }, "startup failed");
  await closeDatabase().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await flushLogger();
  process.exit(1);
}
