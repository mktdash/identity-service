import { fastify, LogController } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { env, trustProxy } from "#config/env";
import { warmSigningKey } from "#lib/jwt/signer";
import { logger } from "#observability/logger";
import { authenticationRoutes } from "#modules/authentication/authentication.routes";
import { healthRoutes } from "#modules/health/health.routes";
import { tokensRoutes } from "#modules/tokens/tokens.routes";
import errorHandlerPlugin from "#plugins/error-handler.plugin";
import rateLimitPlugin from "#plugins/rate-limit.plugin";
import requestContextPlugin, {
  genReqId,
} from "#plugins/request-context.plugin";
import requestLoggingPlugin from "#plugins/request-logging.plugin";
import securityPlugin from "#plugins/security.plugin";
import swaggerPlugin from "#plugins/swagger.plugin";

export async function buildApp() {
  const app = fastify({
    loggerInstance: logger,
    genReqId,
    trustProxy,
    bodyLimit: env.BODY_LIMIT_BYTES,
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(requestContextPlugin);
  await app.register(requestLoggingPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin);
  await app.register(rateLimitPlugin);
  await app.register(swaggerPlugin);

  const kid = await warmSigningKey();
  app.log.info(
    { event: "signing_key_loaded", kid, alg: "EdDSA" },
    "signing key loaded",
  );

  await app.register(healthRoutes);
  await app.register(tokensRoutes);
  await app.register(authenticationRoutes, { prefix: "/v1/auth" });

  await app.ready();

  return app;
}
