import { generateKeyPairSync } from "node:crypto";
import { exportJWK, importPKCS8, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  JWKS_CACHE,
  JWKS_CACHE_CONTROL,
  JWKS_ROUTE,
  JWT_ALGORITHM,
} from "#config/constants";
import type { AppError } from "#lib/errors/app-error";
import { ERROR_CODES } from "#lib/errors/codes";
import { jwksResponseSchema, publicJwkSchema } from "../tokens.dto.ts";
import {
  createTokensService,
  type SigningKeyDescriptor,
} from "../tokens.service.ts";

const PRIVATE_JWK_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k"] as const;

async function realEd25519Jwk(): Promise<JWK> {
  const pem = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();

  const key = await importPKCS8(pem, JWT_ALGORITHM, { extractable: true });
  return exportJWK(key);
}

async function rejectionFrom(promise: Promise<unknown>): Promise<AppError> {
  let caught: unknown;
  let rejected = false;

  try {
    await promise;
  } catch (error) {
    caught = error;
    rejected = true;
  }

  if (!rejected) {
    throw new Error("expected the promise to reject, but it resolved");
  }

  return caught as AppError;
}

function serviceFor(
  descriptors: readonly SigningKeyDescriptor[] | (() => Promise<never>),
) {
  return createTokensService({
    loadSigningKeys:
      typeof descriptors === "function"
        ? descriptors
        : () => Promise.resolve(descriptors),
  });
}

describe("tokens service — JWKS publication", () => {
  let privateJwk: JWK;

  beforeAll(async () => {
    privateJwk = await realEd25519Jwk();
  });

  it("publishes an RFC 7517 key set for the active signing key", async () => {
    const service = serviceFor([{ kid: "key-2026-08", publicJwk: privateJwk }]);

    const document = await service.getJwks();

    expect(jwksResponseSchema.parse(document)).toEqual(document);
    expect(document.keys).toHaveLength(1);
    expect(document.keys[0]).toMatchObject({
      kty: "OKP",
      crv: "Ed25519",
      kid: "key-2026-08",
      alg: "EdDSA",
      use: "sig",
    });
  });

  it("never serves the private key, even when handed the full private JWK", async () => {
    expect(privateJwk.d).toBeTypeOf("string");

    const service = serviceFor([{ kid: "leaky", publicJwk: privateJwk }]);

    const document = await service.getJwks();
    const [served] = document.keys;

    expect(served).toBeDefined();
    expect(served).not.toHaveProperty("d");

    for (const member of PRIVATE_JWK_MEMBERS) {
      expect(served).not.toHaveProperty(member);
    }

    expect(JSON.stringify(document)).not.toContain(String(privateJwk.d));
  });

  it("emits exactly the allowlisted JWK members and nothing else", async () => {
    const service = serviceFor([
      {
        kid: "extra",
        publicJwk: {
          ...privateJwk,
          key_ops: ["sign"],
          ext: true,
        } as JWK,
      },
    ]);

    const [served] = (await service.getJwks()).keys;

    expect(Object.keys(served ?? {}).toSorted()).toEqual([
      "alg",
      "crv",
      "kid",
      "kty",
      "use",
      "x",
    ]);
  });

  it("publishes every key during a rotation overlap, newest first", async () => {
    const incoming = await realEd25519Jwk();
    const service = serviceFor([
      { kid: "incoming", publicJwk: incoming },
      { kid: "outgoing", publicJwk: privateJwk },
    ]);

    const document = await service.getJwks();

    expect(document.keys.map((key) => key.kid)).toEqual([
      "incoming",
      "outgoing",
    ]);
    expect(document.keys[0]?.x).not.toBe(document.keys[1]?.x);
  });

  it("fails closed with 503 when no key is published", async () => {
    const error = await rejectionFrom(serviceFor([]).getJwks());

    expect(error.status).toBe(503);
    expect(error.code).toBe(ERROR_CODES.signingKeyUnavailable);
    expect(error.headers["retry-after"]).toBe("30");
    expect(error.headers["cache-control"]).toBe("no-store");
  });

  it("fails closed with 503 when the key cannot be loaded", async () => {
    const error = await rejectionFrom(
      serviceFor(() =>
        Promise.reject(new Error("secret store unreachable")),
      ).getJwks(),
    );

    expect(error.status).toBe(503);
    expect(error.code).toBe(ERROR_CODES.signingKeyUnavailable);
  });

  it("refuses a non-Ed25519 key rather than publishing an unverifiable one", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaJwk = await exportJWK(
      await importPKCS8(
        rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        "RS256",
        { extractable: true },
      ),
    );

    const error = await rejectionFrom(
      serviceFor([{ kid: "rsa", publicJwk: rsaJwk }]).getJwks(),
    );

    expect(error.status).toBe(503);
    expect(error.code).toBe(ERROR_CODES.signingKeyUnavailable);
    expect(error.detail).not.toContain("kty");
  });

  it("refuses a key with no kid — clients select on kid, never on position", async () => {
    const error = await rejectionFrom(
      serviceFor([{ kid: "", publicJwk: privateJwk }]).getJwks(),
    );

    expect(error.code).toBe(ERROR_CODES.signingKeyUnavailable);
  });
});

describe("tokens DTO — the serializer allowlist", () => {
  it("strips a private component instead of serializing it", async () => {
    const jwk = await realEd25519Jwk();

    const parsed = publicJwkSchema.parse({
      kty: "OKP",
      crv: "Ed25519",
      x: jwk.x,
      d: jwk.d,
      kid: "k",
      alg: "EdDSA",
      use: "sig",
    });

    expect(parsed).not.toHaveProperty("d");
  });

  it("rejects a key set that is missing the algorithm binding", async () => {
    const jwk = await realEd25519Jwk();

    const result = jwksResponseSchema.safeParse({
      keys: [{ kty: "OKP", crv: "Ed25519", x: jwk.x, kid: "k", use: "sig" }],
    });

    expect(result.success).toBe(false);
  });
});

describe("JWKS cacheability", () => {
  it("is served from a well-known URI, at the root and not under /v1", () => {
    expect(JWKS_ROUTE).toBe("/.well-known/jwks.json");
    expect(JWKS_ROUTE.startsWith("/v1")).toBe(false);
  });

  it("caches for less than one access-token lifetime", () => {
    expect(JWKS_CACHE.maxAgeSeconds).toBeLessThan(900);
    expect(JWKS_CACHE.maxAgeSeconds).toBeGreaterThan(0);
  });

  it("survives an identity-service outage rather than failing every verification", () => {
    expect(JWKS_CACHE.staleIfErrorSeconds).toBeGreaterThan(
      JWKS_CACHE.maxAgeSeconds,
    );
    expect(JWKS_CACHE_CONTROL).toBe(
      "public, max-age=300, stale-while-revalidate=300, stale-if-error=86400",
    );
  });

  it("never carries no-store — that is the whole point of the exemption", () => {
    expect(JWKS_CACHE_CONTROL).not.toContain("no-store");
    expect(JWKS_CACHE_CONTROL).not.toContain("private");
  });
});
