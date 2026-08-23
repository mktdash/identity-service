import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { REFRESH_TOKEN_BYTES } from "#config/constants";

export function generateOpaqueToken(
  bytes: number = REFRESH_TOKEN_BYTES,
): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");

  if (a.length !== b.length || a.length === 0) {
    return false;
  }

  return timingSafeEqual(a, b);
}
