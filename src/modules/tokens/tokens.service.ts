import type { JWK } from "jose";
import { JWT_ALGORITHM } from "#config/constants";
import { getSigningKey } from "#lib/jwt/signer";
import type { JwksResponse, PublicJwk } from "./tokens.dto.ts";
import { SigningKeyUnavailableError } from "./tokens.errors.ts";

export type SigningKeyDescriptor = {
  readonly kid: string;
  readonly publicJwk: JWK;
};

export type TokensServiceDeps = {
  readonly loadSigningKeys: () => Promise<readonly SigningKeyDescriptor[]>;
};

async function loadActiveSigningKeys(): Promise<
  readonly SigningKeyDescriptor[]
> {
  const { kid, publicJwk } = await getSigningKey();
  return [{ kid, publicJwk }];
}

function toPublicJwk(descriptor: SigningKeyDescriptor): PublicJwk {
  const { kty, crv, x } = descriptor.publicJwk;

  if (kty !== "OKP") {
    throw new SigningKeyUnavailableError(`unexpected kty "${String(kty)}"`);
  }

  if (crv !== "Ed25519") {
    throw new SigningKeyUnavailableError(`unexpected crv "${String(crv)}"`);
  }

  if (typeof x !== "string" || x.length === 0) {
    throw new SigningKeyUnavailableError("public key has no `x` component");
  }

  if (descriptor.kid.length === 0) {
    throw new SigningKeyUnavailableError("signing key has no `kid`");
  }

  return {
    kty: "OKP",
    crv: "Ed25519",
    x,
    kid: descriptor.kid,
    alg: JWT_ALGORITHM,
    use: "sig",
  };
}

export type TokensService = {
  getJwks: () => Promise<JwksResponse>;
};

export function createTokensService(
  deps: TokensServiceDeps = { loadSigningKeys: loadActiveSigningKeys },
): TokensService {
  async function getJwks(): Promise<JwksResponse> {
    let descriptors: readonly SigningKeyDescriptor[];

    try {
      descriptors = await deps.loadSigningKeys();
    } catch (cause) {
      throw new SigningKeyUnavailableError("signing key failed to load", cause);
    }

    if (descriptors.length === 0) {
      throw new SigningKeyUnavailableError("no signing key is published");
    }

    return { keys: descriptors.map(toPublicJwk) };
  }

  return { getJwks };
}

export const tokensService: TokensService = createTokensService();
