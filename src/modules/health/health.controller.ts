import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "#config/env";
import { getLiveness, getReadiness } from "./health.service.ts";

export function liveness(_request: FastifyRequest, reply: FastifyReply): void {
  void reply.code(200).send(getLiveness(env.SERVICE_NAME));
}

export async function readiness(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await getReadiness();
  await reply.code(result.status === "ready" ? 200 : 503).send(result);
}
