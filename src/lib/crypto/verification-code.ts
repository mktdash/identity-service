import { randomInt } from "node:crypto";
import { EMAIL_VERIFICATION } from "#config/constants";

export function generateVerificationCode(
  length: number = EMAIL_VERIFICATION.codeLength,
): string {
  const upperBound = 10 ** length;
  return String(randomInt(0, upperBound)).padStart(length, "0");
}

const DIGITS_ONLY = /^\d+$/u;

export function normalizeVerificationCode(
  raw: string,
  length: number = EMAIL_VERIFICATION.codeLength,
): string {
  return raw.replace(/\D/gu, "").slice(0, length);
}

export function isWellFormedVerificationCode(
  code: string,
  length: number = EMAIL_VERIFICATION.codeLength,
): boolean {
  return code.length === length && DIGITS_ONLY.test(code);
}
