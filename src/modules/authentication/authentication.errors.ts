import { AppError } from "#lib/errors/app-error";
import { ERROR_CODES } from "#lib/errors/codes";

export class EmailAlreadyRegisteredError extends AppError {
  constructor(cause?: unknown) {
    super({
      status: 409,
      code: ERROR_CODES.emailAlreadyRegistered,
      title: "Email already registered",
      detail:
        "An account with this email address already exists. Sign in instead, or reset the password.",
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class RolePresetNotProvisionedError extends AppError {
  constructor(slug: string) {
    super({
      status: 500,
      code: ERROR_CODES.roleNotProvisioned,
      title: "Role preset not provisioned",
      detail:
        "Registration is temporarily unavailable. This has been logged and reported.",
      logContext: {
        missingRoleSlug: slug,
        remediation: "run `pnpm seed:system` against this database",
      },
    });
  }
}

export class PasswordBreachedError extends AppError {
  constructor(source: "local" | "hibp") {
    super({
      status: 400,
      code: ERROR_CODES.passwordBreached,
      title: "Password found in a breach",
      detail:
        "That password appears in known breach lists. Pick another one before continuing.",
      logContext: { breachSource: source },
    });
  }
}

export class InvalidVerificationCodeError extends AppError {
  constructor(logContext: Record<string, unknown> = {}) {
    super({
      status: 400,
      code: ERROR_CODES.invalidVerificationCode,
      title: "Invalid verification code",
      detail: "That code is not correct. Check the code and try again.",
      logContext,
    });
  }
}

export class VerificationCodeExpiredError extends AppError {
  constructor() {
    super({
      status: 410,
      code: ERROR_CODES.verificationCodeExpired,
      title: "Verification code expired",
      detail: "That code has expired. Request a new one and try again.",
    });
  }
}

export class TooManyVerificationAttemptsError extends AppError {
  constructor(logContext: Record<string, unknown> = {}) {
    super({
      status: 429,
      code: ERROR_CODES.tooManyVerificationAttempts,
      title: "Too many attempts",
      detail:
        "Too many incorrect codes. That code is no longer valid — request a new one.",
      logContext,
    });
  }
}

export class OrganizationSlugUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super({
      status: 409,
      code: ERROR_CODES.organizationSlugUnavailable,
      title: "Organization name unavailable",
      detail:
        "That organization name could not be reserved. Please try again, or choose a different name.",
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
