import { randomUUID } from "node:crypto";
import {
  calculateJwkThumbprint,
  exportJWK,
  importPKCS8,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { JWT_ALGORITHM, TOKEN_TYPES } from "#config/constants";
import { env } from "#config/env";
import type { AccessTokenInput } from "./claims.ts";

export type SigningKeyMaterial = {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
};

function decodePrivateKeyPem(): string {
  const decoded = Buffer.from(env.JWT_SIGNING_KEY, "base64").toString("utf8");

  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "JWT_SIGNING_KEY is not a base64-encoded PKCS#8 PEM private key. " +
        "Generate one with `pnpm key:generate`.",
    );
  }

  return decoded;
}

async function loadSigningKey(): Promise<SigningKeyMaterial> {
  const privateKey = await importPKCS8(decodePrivateKeyPem(), JWT_ALGORITHM, {
    extractable: true,
  });

  const privateJwk = await exportJWK(privateKey);

  if (privateJwk.crv !== "Ed25519") {
    throw new Error(
      `JWT_SIGNING_KEY must be an Ed25519 key; got crv="${String(privateJwk.crv)}". ` +
        "HS* and RS* are not accepted — symmetric signing would let every " +
        "verifying service mint tokens.",
    );
  }

  const { d: _privateScalar, ...publicJwk } = privateJwk;

  const kid =
    env.JWT_SIGNING_KEY_ID ??
    (await calculateJwkThumbprint(publicJwk, "sha256"));

  return {
    kid,
    privateKey,
    publicJwk: { ...publicJwk, kid, alg: JWT_ALGORITHM, use: "sig" },
  };
}

let cached: Promise<SigningKeyMaterial> | undefined;

export function getSigningKey(): Promise<SigningKeyMaterial> {
  cached ??= loadSigningKey();
  return cached;
}

export async function warmSigningKey(): Promise<string> {
  return (await getSigningKey()).kid;
}

export type SignedAccessToken = {
  readonly token: string;
  readonly expiresAt: Date;
  readonly issuedAt: Date;
  readonly jti: string;
  readonly expiresInSeconds: number;
};

export async function signAccessToken(
  input: AccessTokenInput,
): Promise<SignedAccessToken> {
  const { kid, privateKey } = await getSigningKey();

  const issuedAtMs = Date.now();
  const issuedAt = Math.floor(issuedAtMs / 1000);
  const expiresInSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
  const expiresAt = issuedAt + expiresInSeconds;
  const jti = randomUUID();

  const builder = new SignJWT({
    typ: TOKEN_TYPES.access,
    sid: input.sessionId,
    org: input.organizationId,
    pv: input.permissionVersion,
    ...(input.workspaceId === undefined ? {} : { ws: input.workspaceId }),
    ...(input.actorUserId === undefined
      ? {}
      : { act: { sub: input.actorUserId } }),
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM, kid, typ: "JWT" })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setSubject(input.userId)
    .setJti(jti)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt);

  return {
    token: await builder.sign(privateKey),
    expiresAt: new Date(expiresAt * 1000),
    issuedAt: new Date(issuedAt * 1000),
    jti,
    expiresInSeconds,
  };
}
