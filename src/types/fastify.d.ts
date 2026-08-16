import type { RequestContext } from "../observability/request-context.ts";

declare module "fastify" {
  interface FastifyRequest {
    readonly ctx: RequestContext;
  }
}
