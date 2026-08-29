import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { JWKS_CACHE, JWKS_ROUTE } from "#config/constants";
import { problemDetailsSchema } from "#lib/errors/problem-details";
import { jwks } from "./tokens.controller.ts";
import { jwksResponseSchema } from "./tokens.dto.ts";

export const tokensRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    JWKS_ROUTE,
    {
      config: { public: true },
      schema: {
        operationId: "getJwks",
        tags: ["tokens"],
        summary: "JSON Web Key Set — the public keys that verify access tokens",
        description:
          "RFC 7517 JWK Set holding the Ed25519 public keys for this service's EdDSA access tokens. " +
          "Public by necessity: the gateway and any load balancer in front of it fetch this before " +
          "a caller has been identified, so it can never require authentication. " +
          `The only route exempt from Cache-Control: no-store — it is served cacheable with max-age=${JWKS_CACHE.maxAgeSeconds}, ` +
          `stale-while-revalidate=${JWKS_CACHE.staleWhileRevalidateSeconds}, stale-if-error=${JWKS_CACHE.staleIfErrorSeconds}. ` +
          "That max-age is part of the key-rotation overlap window: a new key is published here before " +
          "anything is signed with it, and the old key is retired no sooner than access-token TTL + max-age + clock skew. " +
          "Clients that cache on their own timer (jose's createRemoteJWKSet defaults to 10 minutes and ignores " +
          "Cache-Control) must set that timer to this max-age or the overlap window must be sized for theirs.",
        response: {
          200: jwksResponseSchema,
          503: problemDetailsSchema,
        },
      },
    },
    jwks,
  );
};
