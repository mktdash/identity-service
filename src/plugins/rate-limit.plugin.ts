import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { RateLimitedError } from "#lib/errors/http-errors";
import { redis } from "#lib/redis/client";

async function rateLimitPlugin(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    redis,
    keyGenerator: (request: FastifyRequest) => request.ip,
    skipOnError: true,
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    errorResponseBuilder: (request, context) =>
      new RateLimitedError(Math.ceil(context.ttl / 1000), {
        route: request.routeOptions.url,
        limit: context.max,
        clientIp: request.ip,
      }),
  });
}

export default fp(rateLimitPlugin, {
  name: "rate-limit",
  fastify: "5.x",
  dependencies: ["request-context"],
});
