import { randomBytes } from "node:crypto";
import { SLUG_MAX_LENGTH, SLUG_SUFFIX_BYTES } from "#config/constants";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isValidSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

export function slugify(
  input: string,
  maxLength: number = SLUG_MAX_LENGTH,
): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, maxLength)
    .replace(/-+$/gu, "");
}

function randomSuffix(bytes: number = SLUG_SUFFIX_BYTES): string {
  const source = randomBytes(bytes);
  let bits = 0;
  let accumulator = 0;
  let out = "";

  for (const byte of source) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(accumulator >>> bits) & 0b11111];
    }
  }

  if (bits > 0) {
    out += ALPHABET[(accumulator << (5 - bits)) & 0b11111];
  }

  return out;
}

export function generateSlug(
  name: string,
  fallback: string,
  suffixBytes: number = SLUG_SUFFIX_BYTES,
): string {
  const suffix = randomSuffix(suffixBytes);
  const room = SLUG_MAX_LENGTH - suffix.length - 1;
  const base = slugify(name, room) || fallback;

  return `${base}-${suffix}`;
}
