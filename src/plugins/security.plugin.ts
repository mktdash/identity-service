import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { JWKS_ROUTE } from "#config/constants";
import { corsAllowedOrigins, isProduction } from "#config/env";

const CACHEABLE_ROUTES: ReadonlySet<string> = new Set([JWKS_ROUTE]);

async function securityPlugin(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  });

  await app.register(cors, {
    origin: corsAllowedOrigins.length === 0 ? false : [...corsAllowedOrigins],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
    maxAge: 600,
  });

  app.addHook("onSend", (request, reply, payload, done) => {
    if (!CACHEABLE_ROUTES.has(request.url.split("?", 1)[0] ?? request.url)) {
      void reply.header("Cache-Control", "no-store");
      void reply.header("Pragma", "no-cache");
    }

    done(null, payload);
  });
}

export default fp(securityPlugin, { name: "security", fastify: "5.x" });
