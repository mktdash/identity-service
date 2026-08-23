import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { EMAIL_VERIFICATION, SLUG_MAX_LENGTH } from "#config/constants";
import type { AppError } from "#lib/errors/app-error";
import type {
  AuthenticationRepository,
  ProvisionTenantInput,
  VerifiedIdentity,
} from "../authentication.repository.ts";
import {
  ORGANIZATIONS_SLUG_UNIQUE_CONSTRAINT,
  USERS_EMAIL_UNIQUE_CONSTRAINT,
} from "../authentication.repository.ts";
import {
  EmailAlreadyRegisteredError,
  InvalidVerificationCodeError,
  OrganizationSlugUnavailableError,
  PasswordBreachedError,
  TooManyVerificationAttemptsError,
  VerificationCodeExpiredError,
} from "../authentication.errors.ts";
import {
  createAuthenticationService,
  normalizeEmail,
  workspaceHomePath,
  type AuthenticationServiceDeps,
} from "../authentication.service.ts";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

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

function uniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error("duplicate key value violates unique constraint"),
    { code: "23505", constraint_name: constraint },
  );
}

function verifiedIdentity(): VerifiedIdentity {
  return {
    user: {
      id: "01920000-0000-7000-8000-000000000003",
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      emailVerified: true,
    },
    organization: {
      id: "01920000-0000-7000-8000-000000000001",
      name: "Acme Co.",
      slug: "acme-co-abc123",
      tenancy: "company",
    },
    workspace: {
      id: "01920000-0000-7000-8000-000000000002",
      name: "Acme Co.",
      slug: "acme-co",
    },
    membership: {
      id: "01920000-0000-7000-8000-000000000004",
      roleId: "01920000-0000-7000-8000-000000000005",
      roleSlug: "super_admin",
      dataScope: "organization",
      permissionVersion: 1,
    },
    session: { id: "01920000-0000-7000-8000-000000000006" },
  };
}

type RepositoryStub = {
  findUserIdByEmail: ReturnType<typeof vi.fn>;
  provisionTenant: ReturnType<typeof vi.fn>;
  verifyEmailAndStartSession: ReturnType<typeof vi.fn>;
  reissueVerificationCode: ReturnType<typeof vi.fn>;
};

const VERIFICATION_CODE = "428913";

type BreachCheckFn = AuthenticationServiceDeps["isBreachedPassword"];
type DeliverCodeFn = AuthenticationServiceDeps["deliverVerificationCode"];

function buildService(
  repositoryOverrides: Partial<RepositoryStub> = {},
  depOverrides: {
    isBreachedPassword?: Mock<BreachCheckFn>;
    deliverVerificationCode?: Mock<DeliverCodeFn>;
  } = {},
) {
  const repository: RepositoryStub = {
    findUserIdByEmail: vi.fn(async () => undefined),
    provisionTenant: vi.fn(async () => ({
      userId: "01920000-0000-7000-8000-000000000003",
      organizationId: "01920000-0000-7000-8000-000000000001",
      workspaceId: "01920000-0000-7000-8000-000000000002",
    })),
    verifyEmailAndStartSession: vi.fn(async () => ({
      outcome: "verified" as const,
      ...verifiedIdentity(),
    })),
    reissueVerificationCode: vi.fn(async () => ({
      outcome: "reissued" as const,
    })),
    ...repositoryOverrides,
  };

  const deliverVerificationCode =
    depOverrides.deliverVerificationCode ??
    vi.fn<DeliverCodeFn>(async () => undefined);
  const isBreachedPassword =
    depOverrides.isBreachedPassword ??
    vi.fn<BreachCheckFn>(async () => ({ breached: false }));

  const service = createAuthenticationService({
    repository: repository as unknown as AuthenticationRepository,
    hashPassword: async (password: string) =>
      `argon2id-fake:${password.length}`,
    isBreachedPassword,
    signAccessToken: async () => ({
      token: "fake.access.token",
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
      issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      jti: "01920000-0000-7000-8000-00000000000a",
      expiresInSeconds: 900,
    }),
    generateOpaqueToken: () => "opaque-refresh-token",
    generateVerificationCode: () => VERIFICATION_CODE,
    hashToken: sha256,
    deliverVerificationCode,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  return { service, repository, deliverVerificationCode, isBreachedPassword };
}

const command = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  password: "correct-horse-battery-staple",
  workspaceName: "Acme Co.",
  tenancy: "company" as const,
  request: {
    requestId: "req-1",
    ipAddress: "203.0.113.7",
    userAgent: "vitest",
  },
};

describe("normalizeEmail", () => {
  it("lowercases and trims, so one mailbox cannot hold two accounts", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });
});

describe("register — contract with mktdash-web", () => {
  it("returns verification-required and no tokens", async () => {
    const { service } = buildService();
    const result = await service.register(command);

    expect(result.status).toBe("verification-required");
    expect(result.email).toBe("ada@example.com");
    expect(JSON.stringify(result)).not.toContain("accessToken");
    expect(JSON.stringify(result)).not.toContain("refreshToken");
  });

  it("carries the tenancy mode through to the organization", async () => {
    const { service, repository } = buildService();
    await service.register({ ...command, tenancy: "agency" });

    const [input] = repository.provisionTenant.mock.calls[0] as [
      ProvisionTenantInput,
    ];
    expect(input.organization.tenancy).toBe("agency");
  });

  it("names the organization and its first workspace from workspaceName", async () => {
    const { service, repository } = buildService();
    await service.register(command);

    const [input] = repository.provisionTenant.mock.calls[0] as [
      ProvisionTenantInput,
    ];
    expect(input.organization.name).toBe("Acme Co.");
    expect(input.workspace.name).toBe("Acme Co.");
  });

  it("delivers the code only after the transaction commits", async () => {
    const { service, deliverVerificationCode, repository } = buildService();
    await service.register(command);

    expect(repository.provisionTenant).toHaveBeenCalledOnce();
    expect(deliverVerificationCode).toHaveBeenCalledWith({
      email: "ada@example.com",
      code: VERIFICATION_CODE,
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
    });
  });

  it("does not send a code when the transaction fails", async () => {
    const { service, deliverVerificationCode } = buildService({
      provisionTenant: vi.fn(async () => {
        throw new Error("connection terminated unexpectedly");
      }),
    });

    await expect(service.register(command)).rejects.toThrow();
    expect(deliverVerificationCode).not.toHaveBeenCalled();
  });

  it("persists only the hash of the verification code", async () => {
    const { service, repository } = buildService();
    await service.register(command);

    const [input] = repository.provisionTenant.mock.calls[0] as [
      ProvisionTenantInput,
    ];
    expect(input.verification.codeHash).toBe(sha256(VERIFICATION_CODE));
    expect(JSON.stringify(input)).not.toContain(VERIFICATION_CODE);
  });

  it("never hands the plaintext password to the repository", async () => {
    const { service, repository } = buildService();
    await service.register(command);

    const [input] = repository.provisionTenant.mock.calls[0] as [
      ProvisionTenantInput,
    ];
    expect(JSON.stringify(input)).not.toContain(command.password);
    expect(input.passwordHash).toMatch(/^argon2id-fake:/u);
  });
});

describe("register — breached password", () => {
  it("rejects a breached password with the code mktdash-web branches on", async () => {
    const { service } = buildService(
      {},
      {
        isBreachedPassword: vi.fn(async () => ({
          breached: true,
          source: "hibp",
        })),
      },
    );

    await expect(service.register(command)).rejects.toMatchObject({
      status: 400,
      code: "password_breached",
    });
  });

  it("checks the password before spending an Argon2id hash on it", async () => {
    const { service, repository } = buildService(
      {},
      {
        isBreachedPassword: vi.fn(async () => ({
          breached: true,
          source: "local",
        })),
      },
    );

    await expect(service.register(command)).rejects.toBeInstanceOf(
      PasswordBreachedError,
    );
    expect(repository.provisionTenant).not.toHaveBeenCalled();
  });

  it("proceeds when the breach service is unavailable, rather than blocking signup", async () => {
    const { service, repository } = buildService(
      {},
      {
        isBreachedPassword: vi.fn(async () => ({
          breached: false,
          unavailable: true,
        })),
      },
    );

    await service.register(command);
    expect(repository.provisionTenant).toHaveBeenCalledOnce();
  });
});

describe("register — duplicate email", () => {
  let stubs: ReturnType<typeof buildService>;

  beforeEach(() => {
    stubs = buildService({
      findUserIdByEmail: vi.fn(
        async () => "01920000-0000-7000-8000-00000000000b",
      ),
    });
  });

  it("rejects with a 409 when the address is already registered", async () => {
    await expect(stubs.service.register(command)).rejects.toMatchObject({
      status: 409,
      code: "email_already_registered",
    });
  });

  it("does not open the transaction — the pre-check is a fast path, not a formality", async () => {
    await expect(stubs.service.register(command)).rejects.toThrow();
    expect(stubs.repository.provisionTenant).not.toHaveBeenCalled();
  });

  it("matches case-insensitively, because the unique index is on the normalized column", async () => {
    await expect(
      stubs.service.register({ ...command, email: "ADA@Example.com" }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);

    expect(stubs.repository.findUserIdByEmail).toHaveBeenCalledWith(
      "ada@example.com",
    );
  });
});

describe("register — concurrent-signup race", () => {
  it("maps the users.email_normalized unique violation to the same 409", async () => {
    const { service, repository } = buildService({
      findUserIdByEmail: vi.fn(async () => undefined),
      provisionTenant: vi.fn(async () => {
        throw uniqueViolation(USERS_EMAIL_UNIQUE_CONSTRAINT);
      }),
    });

    await expect(service.register(command)).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
    expect(repository.findUserIdByEmail).toHaveBeenCalledOnce();
    expect(repository.provisionTenant).toHaveBeenCalledOnce();
  });

  it("is indistinguishable from the fast path, so the race is not observable", async () => {
    const fast = buildService({
      findUserIdByEmail: vi.fn(async () => "existing-user-id"),
    });
    const raced = buildService({
      provisionTenant: vi.fn(async () => {
        throw uniqueViolation(USERS_EMAIL_UNIQUE_CONSTRAINT);
      }),
    });

    const fastError = await rejectionFrom(fast.service.register(command));
    const racedError = await rejectionFrom(raced.service.register(command));

    expect(racedError.toProblemDetails()).toEqual(fastError.toProblemDetails());
  });

  it("maps an organization slug collision to its own error, not to a taken email", async () => {
    const { service } = buildService({
      provisionTenant: vi.fn(async () => {
        throw uniqueViolation(ORGANIZATIONS_SLUG_UNIQUE_CONSTRAINT);
      }),
    });

    await expect(service.register(command)).rejects.toBeInstanceOf(
      OrganizationSlugUnavailableError,
    );
  });

  it("lets an unrelated unique violation bubble rather than mislabelling it", async () => {
    const { service } = buildService({
      provisionTenant: vi.fn(async () => {
        throw uniqueViolation("some_other_table_key");
      }),
    });

    await expect(service.register(command)).rejects.not.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it("lets a non-constraint failure bubble untouched", async () => {
    const failure = new Error("connection terminated unexpectedly");
    const { service } = buildService({
      provisionTenant: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(service.register(command)).rejects.toBe(failure);
  });
});

describe("register — slugs", () => {
  async function slugsFor(workspaceName: string) {
    const { service, repository } = buildService();
    await service.register({ ...command, workspaceName });

    const [input] = repository.provisionTenant.mock.calls[0] as [
      ProvisionTenantInput,
    ];
    return { org: input.organization.slug, workspace: input.workspace.slug };
  }

  it("is URL-safe: lowercase alphanumerics and single hyphens only", async () => {
    const { org, workspace } = await slugsFor("Acme Marketing Ltd.");

    for (const slug of [org, workspace]) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(slug).toBe(encodeURIComponent(slug));
    }
  });

  it("gives the workspace a clean slug for the /w/<slug>/home URL", async () => {
    const { workspace } = await slugsFor("Acme Co.");
    expect(workspace).toBe("acme-co");
  });

  it("gives the organization a random suffix, because its slug is global", async () => {
    const { org } = await slugsFor("Acme Co.");
    expect(org).toMatch(/^acme-co-[0-9a-hjkmnp-tv-z]+$/u);
  });

  it("produces a different organization slug for the same name every time", async () => {
    const slugs = new Set(
      await Promise.all(
        Array.from({ length: 25 }, async () => (await slugsFor("Acme")).org),
      ),
    );

    expect(slugs.size).toBe(25);
  });

  it("never exceeds the slug budget, even for a very long name", async () => {
    const { org } = await slugsFor("A".repeat(400));

    expect(org.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(org).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  });

  it("falls back to a usable stem when the name transliterates to nothing", async () => {
    const { org, workspace } = await slugsFor("日本語株式会社");

    expect(org).toMatch(/^org-[0-9a-hjkmnp-tv-z]+$/u);
    expect(workspace).toBe("workspace");
  });

  it("strips diacritics rather than dropping the characters", async () => {
    const { workspace } = await slugsFor("Ünïcôdé Ltd");
    expect(workspace).toBe("unicode-ltd");
  });
});

describe("verifyEmail", () => {
  it("issues the token pair and the workspace redirect on success", async () => {
    const { service } = buildService();
    const result = await service.verifyEmail({
      email: "ada@example.com",
      code: VERIFICATION_CODE,
      request: command.request,
    });

    expect(result.status).toBe("verified");
    expect(result.redirectTo).toBe("/w/acme-co/home");
    expect(result.tokens).toMatchObject({
      accessToken: "fake.access.token",
      tokenType: "Bearer",
      expiresIn: 900,
      refreshToken: "opaque-refresh-token",
    });
    expect(result.user.emailVerified).toBe(true);
  });

  it("sends only the hash of the submitted code to the repository", async () => {
    const { service, repository } = buildService();
    await service.verifyEmail({
      email: "ada@example.com",
      code: VERIFICATION_CODE,
      request: command.request,
    });

    const [input] = repository.verifyEmailAndStartSession.mock.calls[0] as [
      { codeHash: string; maxAttempts: number },
    ];
    expect(input.codeHash).toBe(sha256(VERIFICATION_CODE));
    expect(input.maxAttempts).toBe(EMAIL_VERIFICATION.maxAttempts);
  });

  it("maps a wrong code to invalid_verification_code", async () => {
    const { service } = buildService({
      verifyEmailAndStartSession: vi.fn(async () => ({
        outcome: "invalid" as const,
        attemptsRemaining: 3,
      })),
    });

    await expect(
      service.verifyEmail({
        email: "ada@example.com",
        code: "000000",
        request: command.request,
      }),
    ).rejects.toBeInstanceOf(InvalidVerificationCodeError);
  });

  it("answers an unknown address exactly as it answers a wrong code", async () => {
    const unknown = buildService({
      verifyEmailAndStartSession: vi.fn(async () => ({
        outcome: "no_pending_code" as const,
      })),
    });
    const wrongCode = buildService({
      verifyEmailAndStartSession: vi.fn(async () => ({
        outcome: "invalid" as const,
        attemptsRemaining: 4,
      })),
    });

    const request = {
      email: "nobody@example.com",
      code: "000000",
      request: command.request,
    };

    const unknownError = await rejectionFrom(
      unknown.service.verifyEmail(request),
    );
    const wrongCodeError = await rejectionFrom(
      wrongCode.service.verifyEmail(request),
    );

    expect(unknownError.toProblemDetails()).toEqual(
      wrongCodeError.toProblemDetails(),
    );
  });

  it("maps an expired code to 410, distinctly from a wrong one", async () => {
    const { service } = buildService({
      verifyEmailAndStartSession: vi.fn(async () => ({
        outcome: "expired" as const,
      })),
    });

    await expect(
      service.verifyEmail({
        email: "ada@example.com",
        code: VERIFICATION_CODE,
        request: command.request,
      }),
    ).rejects.toBeInstanceOf(VerificationCodeExpiredError);
  });

  it("maps a spent attempt budget to 429", async () => {
    const { service } = buildService({
      verifyEmailAndStartSession: vi.fn(async () => ({
        outcome: "too_many_attempts" as const,
      })),
    });

    await expect(
      service.verifyEmail({
        email: "ada@example.com",
        code: "000000",
        request: command.request,
      }),
    ).rejects.toBeInstanceOf(TooManyVerificationAttemptsError);
  });
});

describe("resendVerification", () => {
  it("reports sent for an unknown address, disclosing nothing", async () => {
    const { service, deliverVerificationCode } = buildService({
      reissueVerificationCode: vi.fn(async () => ({
        outcome: "no_such_pending_user" as const,
      })),
    });

    const result = await service.resendVerification({
      email: "nobody@example.com",
      request: command.request,
    });

    expect(result).toEqual({
      status: "sent",
      retryAfterSeconds: EMAIL_VERIFICATION.resendCooldownSeconds,
    });
    expect(deliverVerificationCode).not.toHaveBeenCalled();
  });

  it("reports sent while cooling down, but does not resend", async () => {
    const { service, deliverVerificationCode } = buildService({
      reissueVerificationCode: vi.fn(async () => ({
        outcome: "cooling_down" as const,
        retryAfterSeconds: 42,
      })),
    });

    const result = await service.resendVerification({
      email: "ada@example.com",
      request: command.request,
    });

    expect(result.status).toBe("sent");
    expect(deliverVerificationCode).not.toHaveBeenCalled();
  });

  it("never leaks the true cooldown remainder", async () => {
    const coolingDown = buildService({
      reissueVerificationCode: vi.fn(async () => ({
        outcome: "cooling_down" as const,
        retryAfterSeconds: 26,
      })),
    });
    const unknown = buildService({
      reissueVerificationCode: vi.fn(async () => ({
        outcome: "no_such_pending_user" as const,
      })),
    });

    const coolingResult = await coolingDown.service.resendVerification({
      email: "ada@example.com",
      request: command.request,
    });
    const unknownResult = await unknown.service.resendVerification({
      email: "nobody@example.com",
      request: command.request,
    });

    expect(coolingResult.retryAfterSeconds).toBe(
      EMAIL_VERIFICATION.resendCooldownSeconds,
    );
    expect(coolingResult).toEqual(unknownResult);
  });

  it("mails a fresh code when the cooldown has elapsed", async () => {
    const { service, deliverVerificationCode } = buildService();

    const result = await service.resendVerification({
      email: "ada@example.com",
      request: command.request,
    });

    expect(result.status).toBe("sent");
    expect(deliverVerificationCode).toHaveBeenCalledWith({
      email: "ada@example.com",
      code: VERIFICATION_CODE,
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
    });
  });

  it("is indistinguishable between a real pending signup and an unknown address", async () => {
    const real = buildService();
    const unknown = buildService({
      reissueVerificationCode: vi.fn(async () => ({
        outcome: "no_such_pending_user" as const,
      })),
    });

    const realResult = await real.service.resendVerification({
      email: "ada@example.com",
      request: command.request,
    });
    const unknownResult = await unknown.service.resendVerification({
      email: "nobody@example.com",
      request: command.request,
    });

    expect(realResult).toEqual(unknownResult);
  });
});

describe("workspaceHomePath", () => {
  it("matches the route mktdash-web redirects to", () => {
    expect(workspaceHomePath("acme")).toBe("/w/acme/home");
  });
});
