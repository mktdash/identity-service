import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import { env } from "#config/env";

export const OPENAPI_DOCUMENT_VERSION = "1.0.0";

async function swaggerPlugin(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "mktdash-identity-service",
        description:
          "Authentication and authorization for Marketing Dashboard. Never called directly from the internet — the gateway verifies JWKS and forwards.",
        version: OPENAPI_DOCUMENT_VERSION,
      },
      servers: [{ url: "/", description: "This service, behind the gateway" }],
      tags: [
        {
          name: "authentication",
          description: "Sign-up, login, token lifecycle",
        },
        { name: "health", description: "Liveness and readiness probes" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "EdDSA (Ed25519) access token. Verify against /.well-known/jwks.json; the `pv` claim is a cache key to validate, never an authority.",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  if (env.SWAGGER_UI_ENABLED) {
    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: true },
    });

    app.log.warn(
      { event: "swagger_ui_enabled", route: "/docs" },
      "Swagger UI is publicly served — never enable this in production without auth in front of it",
    );
  }
}

export default fp(swaggerPlugin, { name: "swagger", fastify: "5.x" });
