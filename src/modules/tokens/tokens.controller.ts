import type { FastifyReply, FastifyRequest } from "fastify";
import { JWKS_CACHE_CONTROL } from "#config/constants";
import type { JwksResponse } from "./tokens.dto.ts";
import { tokensService } from "./tokens.service.ts";

export async function jwks(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const document: JwksResponse = await tokensService.getJwks();

  await reply
    .code(200)
    .header("cache-control", JWKS_CACHE_CONTROL)
    .send(document);
}
