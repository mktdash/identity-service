import {
  EMAIL_VERIFICATION,
  FALLBACK_ORGANIZATION_SLUG,
  FALLBACK_WORKSPACE_SLUG,
  REGISTRATION_DEFAULTS,
} from "#config/constants";
import { env } from "#config/env";
import {
  isBreachedPassword,
  type BreachCheckResult,
} from "#lib/crypto/breached-password";
import { hashPassword } from "#lib/crypto/password";
import { generateOpaqueToken, hashToken } from "#lib/crypto/token-hash";
import { generateVerificationCode } from "#lib/crypto/verification-code";
import { isUniqueViolation } from "#lib/errors/postgres";
import { signAccessToken } from "#lib/jwt/signer";
import { deliverVerificationCode } from "#lib/mail/verification-code-mail";
import { generateSlug, slugify } from "#lib/slug";
import type {
  RegisterResponse,
  ResendVerificationResponse,
  VerifyEmailResponse,
} from "./authentication.dto.ts";
import {
  EmailAlreadyRegisteredError,
  InvalidVerificationCodeError,
  OrganizationSlugUnavailableError,
  PasswordBreachedError,
  TooManyVerificationAttemptsError,
  VerificationCodeExpiredError,
} from "./authentication.errors.ts";
import {
  authenticationRepository,
  ORGANIZATIONS_SLUG_UNIQUE_CONSTRAINT,
  USERS_EMAIL_UNIQUE_CONSTRAINT,
  type AuthenticationRepository,
  type RequestMetadata,
} from "./authentication.repository.ts";

export type RegisterCommand = {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly workspaceName: string;
  readonly tenancy: "company" | "agency";
  readonly request: RequestMetadata;
};

export type VerifyEmailCommand = {
  readonly email: string;
  readonly code: string;
  readonly request: RequestMetadata;
};

export type ResendVerificationCommand = {
  readonly email: string;
  readonly request: RequestMetadata;
};

export type AuthenticationServiceDeps = {
  readonly repository: AuthenticationRepository;
  readonly hashPassword: (password: string) => Promise<string>;
  readonly isBreachedPassword: (password: string) => Promise<BreachCheckResult>;
  readonly signAccessToken: typeof signAccessToken;
  readonly generateOpaqueToken: () => string;
  readonly generateVerificationCode: () => string;
  readonly hashToken: (token: string) => string;
  readonly deliverVerificationCode: typeof deliverVerificationCode;
  readonly now: () => Date;
};

const defaultDeps: AuthenticationServiceDeps = {
  repository: authenticationRepository,
  hashPassword,
  isBreachedPassword,
  signAccessToken,
  generateOpaqueToken,
  generateVerificationCode: () => generateVerificationCode(),
  hashToken,
  deliverVerificationCode,
  now: () => new Date(),
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function workspaceHomePath(workspaceSlug: string): string {
  return `/w/${workspaceSlug}/home`;
}

export type AuthenticationService = {
  register(command: RegisterCommand): Promise<RegisterResponse>;
  verifyEmail(command: VerifyEmailCommand): Promise<VerifyEmailResponse>;
  resendVerification(
    command: ResendVerificationCommand,
  ): Promise<ResendVerificationResponse>;
};

export function createAuthenticationService(
  overrides: Partial<AuthenticationServiceDeps> = {},
): AuthenticationService {
  const deps: AuthenticationServiceDeps = { ...defaultDeps, ...overrides };

  function issueVerificationCode(): {
    code: string;
    codeHash: string;
    expiresAt: Date;
  } {
    const code = deps.generateVerificationCode();

    return {
      code,
      codeHash: deps.hashToken(code),
      expiresAt: new Date(
        deps.now().getTime() + EMAIL_VERIFICATION.ttlSeconds * 1000,
      ),
    };
  }

  async function register(command: RegisterCommand): Promise<RegisterResponse> {
    const emailNormalized = normalizeEmail(command.email);
    const existing = await deps.repository.findUserIdByEmail(emailNormalized);
    if (existing !== undefined) {
      throw new EmailAlreadyRegisteredError();
    }

    const breach = await deps.isBreachedPassword(command.password);
    if (breach.breached) {
      throw new PasswordBreachedError(breach.source);
    }

    const passwordHash = await deps.hashPassword(command.password);

    const organizationSlug = generateSlug(
      command.workspaceName,
      FALLBACK_ORGANIZATION_SLUG,
    );
    const workspaceSlug =
      slugify(command.workspaceName) || FALLBACK_WORKSPACE_SLUG;

    const verification = issueVerificationCode();

    try {
      await deps.repository.provisionTenant({
        organization: {
          name: command.workspaceName,
          slug: organizationSlug,
          tenancy: command.tenancy,
        },
        workspace: { name: command.workspaceName, slug: workspaceSlug },
        user: {
          email: command.email.trim(),
          emailNormalized,
          fullName: command.fullName,
        },
        passwordHash,
        roleSlug: REGISTRATION_DEFAULTS.ownerRoleSlug,
        dataScope: REGISTRATION_DEFAULTS.ownerDataScope,
        verification: {
          codeHash: verification.codeHash,
          expiresAt: verification.expiresAt,
        },
        request: command.request,
      });
    } catch (error) {
      if (isUniqueViolation(error, USERS_EMAIL_UNIQUE_CONSTRAINT)) {
        throw new EmailAlreadyRegisteredError(error);
      }

      if (isUniqueViolation(error, ORGANIZATIONS_SLUG_UNIQUE_CONSTRAINT)) {
        throw new OrganizationSlugUnavailableError(error);
      }

      throw error;
    }

    await deps.deliverVerificationCode({
      email: command.email.trim(),
      code: verification.code,
      expiresAt: verification.expiresAt,
    });

    return {
      status: "verification-required",
      email: command.email.trim(),
      expiresInSeconds: EMAIL_VERIFICATION.ttlSeconds,
      resendAvailableInSeconds: EMAIL_VERIFICATION.resendCooldownSeconds,
    };
  }

  async function verifyEmail(
    command: VerifyEmailCommand,
  ): Promise<VerifyEmailResponse> {
    const emailNormalized = normalizeEmail(command.email);
    const now = deps.now();

    const refreshToken = deps.generateOpaqueToken();
    const sessionExpiresAt = new Date(
      now.getTime() + env.REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    const result = await deps.repository.verifyEmailAndStartSession({
      emailNormalized,
      codeHash: deps.hashToken(command.code),
      maxAttempts: EMAIL_VERIFICATION.maxAttempts,
      now,
      session: { expiresAt: sessionExpiresAt },
      refreshToken: {
        tokenHash: deps.hashToken(refreshToken),
        expiresAt: sessionExpiresAt,
      },
      request: command.request,
    });

    switch (result.outcome) {
      case "expired":
        throw new VerificationCodeExpiredError();

      case "too_many_attempts":
        throw new TooManyVerificationAttemptsError({ email: emailNormalized });
      case "no_pending_code":
        throw new InvalidVerificationCodeError({ reason: "no_pending_code" });

      case "invalid":
        throw new InvalidVerificationCodeError({
          reason: "code_mismatch",
          attemptsRemaining: result.attemptsRemaining,
        });

      case "verified":
        break;
    }

    const accessToken = await deps.signAccessToken({
      userId: result.user.id,
      sessionId: result.session.id,
      organizationId: result.organization.id,
      workspaceId: result.workspace.id,
      permissionVersion: result.membership.permissionVersion,
    });

    return {
      status: "verified",
      redirectTo: workspaceHomePath(result.workspace.slug),
      user: result.user,
      organization: result.organization,
      workspace: result.workspace,
      membership: result.membership,
      tokens: {
        accessToken: accessToken.token,
        tokenType: "Bearer",
        expiresIn: accessToken.expiresInSeconds,
        refreshToken,
        refreshExpiresIn: env.REFRESH_TOKEN_TTL_SECONDS,
      },
    };
  }

  async function resendVerification(
    command: ResendVerificationCommand,
  ): Promise<ResendVerificationResponse> {
    const emailNormalized = normalizeEmail(command.email);
    const verification = issueVerificationCode();

    const result = await deps.repository.reissueVerificationCode({
      emailNormalized,
      verification: {
        codeHash: verification.codeHash,
        expiresAt: verification.expiresAt,
      },
      cooldownSeconds: EMAIL_VERIFICATION.resendCooldownSeconds,
      now: deps.now(),
      request: command.request,
    });

    if (result.outcome === "reissued") {
      await deps.deliverVerificationCode({
        email: command.email.trim(),
        code: verification.code,
        expiresAt: verification.expiresAt,
      });
    }

    return {
      status: "sent",
      retryAfterSeconds: EMAIL_VERIFICATION.resendCooldownSeconds,
    };
  }

  return { register, verifyEmail, resendVerification };
}

export const authenticationService = createAuthenticationService();
