import { z } from "zod";
import { JWT_ALGORITHM } from "#config/constants";

export const publicJwkSchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z
      .string()
      .min(1)
      .describe(
        "Base64url-encoded Ed25519 public key. There is deliberately no `d` member — " +
          "private key material never leaves the secret store.",
      ),
    kid: z
      .string()
      .min(1)
      .describe(
        "Matches the `kid` in the JWT protected header. Select on this, never on position.",
      ),
    alg: z.literal(JWT_ALGORITHM),
    use: z.literal("sig"),
  })
  .describe(
    "RFC 7517 JWK. This schema is a positive allowlist: the serializer emits these members " +
      "and nothing else, so no private component can reach the wire even if one were added upstream.",
  );

export type PublicJwk = z.output<typeof publicJwkSchema>;

export const jwksResponseSchema = z
  .object({
    keys: z
      .array(publicJwkSchema)
      .min(1)
      .describe(
        "One entry today. During a key rotation this carries both the incoming and the " +
          "outgoing key — the new key is published here before anything is signed with it, " +
          "and the old one is retired no sooner than access-token TTL + this response's " +
          "max-age + clock skew.",
      ),
  })
  .describe("RFC 7517 JWK Set");

export type JwksResponse = z.output<typeof jwksResponseSchema>;
