import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { liveness, readiness } from "./health.controller.ts";
import {
  livenessResponseSchema,
  readinessResponseSchema,
} from "./health.dto.ts";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      config: { public: true },
      schema: {
        operationId: "getLiveness",
        tags: ["health"],
        summary: "Liveness probe — process only, no dependency checks",
        response: { 200: livenessResponseSchema },
      },
    },
    liveness,
  );

  app.get(
    "/ready",
    {
      config: { public: true },
      schema: {
        operationId: "getReadiness",
        tags: ["health"],
        summary: "Readiness probe — checks Postgres and Redis",
        response: {
          200: readinessResponseSchema,
          503: readinessResponseSchema,
        },
      },
    },
    readiness,
  );
};
