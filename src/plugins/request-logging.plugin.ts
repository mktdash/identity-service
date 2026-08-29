import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { PROBE_ROUTES } from "#config/constants";
import { sanitizeUrl, truncate } from "#observability/redaction";

export const REQUEST_COMPLETED_EVENT = "request_completed";

const UNMATCHED_ROUTE = "unmatched";

const MAX_LOGGED_USER_AGENT = 256;

export function routeOf(request: FastifyRequest): string {
  return request.routeOptions.url ?? UNMATCHED_ROUTE;
}

export function shouldLogRequest(route: string, status: number): boolean {
  return !PROBE_ROUTES.has(route) || status >= 400;
}

export function levelFor(status: number): "info" | "warn" | "error" {
  if (status >= 500) {
    return "error";
  }

  return status >= 400 ? "warn" : "info";
}

function userAgentOf(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  return typeof value === "string" && value.length > 0
    ? truncate(value, MAX_LOGGED_USER_AGENT)
    : undefined;
}

async function requestLoggingPlugin(app: FastifyInstance): Promise<void> {
  app.addHook(
    "onResponse",
    (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
      const route = routeOf(request);
      const status = reply.statusCode;

      if (!shouldLogRequest(route, status)) {
        done();
        return;
      }

      const userAgent = userAgentOf(request);

      request.log[levelFor(status)](
        {
          event: REQUEST_COMPLETED_EVENT,
          method: request.method,
          route,
          url: sanitizeUrl(request.url),
          status,
          durationMs: Math.round(reply.elapsedTime * 1000) / 1000,
          clientIp: request.ip,
          ...(userAgent === undefined ? {} : { userAgent }),
        },
        "request completed",
      );

      done();
    },
  );
}

export default fp(requestLoggingPlugin, {
  name: "request-logging",
  fastify: "5.x",
  dependencies: ["request-context"],
});
