import type { RequestContext } from "#observability/request-context";

declare module "fastify" {
  interface FastifyRequest {
    readonly ctx: RequestContext;
  }
}
