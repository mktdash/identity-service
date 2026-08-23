import { generateKeyPairSync } from "node:crypto";
import { calculateJwkThumbprint, exportJWK } from "jose";
import { JWT_ALGORITHM } from "../src/config/constants.ts";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const spkiPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const publicJwk = await exportJWK(publicKey);
const kid = await calculateJwkThumbprint(publicJwk, "sha256");

const encoded = Buffer.from(pkcs8Pem, "utf8").toString("base64");

process.stdout.write(
  [
    "",
    "Ed25519 signing key generated.",
    "",
    `  algorithm : ${JWT_ALGORITHM} (Ed25519)`,
    `  kid       : ${kid}   (RFC 7638 JWK thumbprint)`,
    "",
    "Add to .env — never commit it, and never reuse a dev key in staging or production:",
    "",
    `JWT_SIGNING_KEY=${encoded}`,
    "",
    "JWT_SIGNING_KEY_ID may be left unset: the kid above is derived from the key",
    "material itself, so the two can never drift apart.",
    "",
    "Public key (SPKI PEM) — safe to share, this is what JWKS publishes:",
    "",
    spkiPem,
    "",
  ].join("\n"),
);
