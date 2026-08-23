export const ERROR_CODES = {
  validationFailed: "validation_failed",
  malformedRequest: "malformed_request",
  unsupportedMediaType: "unsupported_media_type",
  notAcceptable: "not_acceptable",
  payloadTooLarge: "payload_too_large",
  notFound: "not_found",
  methodNotAllowed: "method_not_allowed",
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  rateLimited: "rate_limited",
  internalError: "internal_error",
  serviceUnavailable: "service_unavailable",

  emailAlreadyRegistered: "email_already_registered",
  organizationSlugUnavailable: "organization_slug_unavailable",
  roleNotProvisioned: "role_not_provisioned",
  invalidCredentials: "invalid_credentials",
  tokenReuseDetected: "token_reuse_detected",
  passwordBreached: "password_breached",
  invalidVerificationCode: "invalid_verification_code",
  verificationCodeExpired: "verification_code_expired",
  tooManyVerificationAttempts: "too_many_verification_attempts",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_TYPE_BASE_URL = "https://errors.mktdash.io";

export function errorTypeUri(code: ErrorCode): string {
  return `${ERROR_TYPE_BASE_URL}/${code.replaceAll("_", "-")}`;
}
