import { and, eq, isNull, sql } from "drizzle-orm";
import {
  ACTOR_TYPES,
  AUDIT_EVENTS,
  type DataScope,
  type TenancyMode,
} from "#config/constants";
import { db } from "#db/client";
import { credentials } from "#db/schema/credentials.schema";
import { memberships } from "#db/schema/memberships.schema";
import { organizations } from "#db/schema/organizations.schema";
import { roles } from "#db/schema/roles.schema";
import { refreshTokens, sessions } from "#db/schema/sessions.schema";
import { users } from "#db/schema/users.schema";
import { workspaces } from "#db/schema/workspaces.schema";
import { nextId, setTenantScope, type Transaction } from "#db/tenant";
import { emitAuditEvent } from "#lib/audit/emit";
import { tokenHashEquals } from "#lib/crypto/token-hash";
import { RolePresetNotProvisionedError } from "./authentication.errors.ts";

export const USERS_EMAIL_UNIQUE_CONSTRAINT = "users_email_normalized_key";
export const ORGANIZATIONS_SLUG_UNIQUE_CONSTRAINT = "organizations_slug_key";

export type RequestMetadata = {
  readonly requestId?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
};

export type VerificationCodeRecord = {
  readonly codeHash: string;
  readonly expiresAt: Date;
};

export type ProvisionTenantInput = {
  readonly organization: {
    readonly name: string;
    readonly slug: string;
    readonly tenancy: TenancyMode;
  };
  readonly workspace: { readonly name: string; readonly slug: string };
  readonly user: {
    readonly email: string;
    readonly emailNormalized: string;
    readonly fullName: string;
  };
  readonly passwordHash: string;
  readonly roleSlug: string;
  readonly dataScope: DataScope;
  readonly verification: VerificationCodeRecord;
  readonly request: RequestMetadata;
};

export type ProvisionedTenant = {
  readonly userId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
};

export type VerifiedIdentity = {
  readonly user: {
    id: string;
    email: string;
    fullName: string;
    emailVerified: boolean;
  };
  readonly organization: {
    id: string;
    name: string;
    slug: string;
    tenancy: TenancyMode;
  };
  readonly workspace: { id: string; name: string; slug: string };
  readonly membership: {
    id: string;
    roleId: string;
    roleSlug: string;
    dataScope: DataScope;
    permissionVersion: number;
  };
  readonly session: { id: string };
};

export type VerifyEmailOutcome =
  | ({ readonly outcome: "verified" } & VerifiedIdentity)
  | { readonly outcome: "no_pending_code" }
  | { readonly outcome: "expired" }
  | { readonly outcome: "too_many_attempts" }
  | { readonly outcome: "invalid"; readonly attemptsRemaining: number };

export type ReissueOutcome =
  | { readonly outcome: "reissued" }
  | { readonly outcome: "cooling_down"; readonly retryAfterSeconds: number }
  | { readonly outcome: "no_such_pending_user" };

export type AuthenticationRepository = {
  findUserIdByEmail(emailNormalized: string): Promise<string | undefined>;
  provisionTenant(input: ProvisionTenantInput): Promise<ProvisionedTenant>;
  verifyEmailAndStartSession(input: {
    readonly emailNormalized: string;
    readonly codeHash: string;
    readonly maxAttempts: number;
    readonly now: Date;
    readonly session: { readonly expiresAt: Date };
    readonly refreshToken: {
      readonly tokenHash: string;
      readonly expiresAt: Date;
    };
    readonly request: RequestMetadata;
  }): Promise<VerifyEmailOutcome>;
  reissueVerificationCode(input: {
    readonly emailNormalized: string;
    readonly verification: VerificationCodeRecord;
    readonly cooldownSeconds: number;
    readonly now: Date;
    readonly request: RequestMetadata;
  }): Promise<ReissueOutcome>;
};

async function findUserIdByEmail(
  emailNormalized: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);

  return row?.id;
}

async function requirePresetRole(
  tx: Transaction,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const [role] = await tx
    .select({ id: roles.id, slug: roles.slug })
    .from(roles)
    .where(
      and(
        eq(roles.slug, slug),
        isNull(roles.organizationId),
        eq(roles.isPreset, true),
      ),
    )
    .limit(1);

  if (role === undefined) {
    throw new RolePresetNotProvisionedError(slug);
  }

  return role;
}

type PrimaryScopeRow = {
  membership_id: string;
  organization_id: string;
  workspace_id: string;
  role_id: string;
  role_slug: string;
  data_scope: string;
  permission_version: number;
};

async function resolvePrimaryScope(
  tx: Transaction,
  userId: string,
): Promise<PrimaryScopeRow | undefined> {
  const rows = await tx.execute<PrimaryScopeRow>(
    sql`select * from app_resolve_primary_scope(${userId}::uuid)`,
  );

  return rows.at(0);
}

async function provisionTenant(
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  return db.transaction(async (tx) => {
    const organizationId = await nextId(tx);
    await setTenantScope(tx, { organizationId });

    const [organization] = await tx
      .insert(organizations)
      .values({
        id: organizationId,
        name: input.organization.name,
        slug: input.organization.slug,
        tenancy: input.organization.tenancy,
      })
      .returning({ id: organizations.id, name: organizations.name });

    if (organization === undefined) {
      throw new Error("Organization insert returned no row");
    }

    const [workspace] = await tx
      .insert(workspaces)
      .values({
        organizationId,
        name: input.workspace.name,
        slug: input.workspace.slug,
      })
      .returning({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
      });

    if (workspace === undefined) {
      throw new Error("Workspace insert returned no row");
    }

    await setTenantScope(tx, { organizationId, workspaceId: workspace.id });

    const role = await requirePresetRole(tx, input.roleSlug);

    const [user] = await tx
      .insert(users)
      .values({
        email: input.user.email,
        emailNormalized: input.user.emailNormalized,
        fullName: input.user.fullName,
      })
      .returning({ id: users.id });

    if (user === undefined) {
      throw new Error("User insert returned no row");
    }

    await tx.insert(credentials).values({
      userId: user.id,
      passwordHash: input.passwordHash,
      emailVerificationTokenHash: input.verification.codeHash,
      emailVerificationExpiresAt: input.verification.expiresAt,
      emailVerificationSentAt: sql`now()`,
      emailVerificationAttempts: 0,
    });

    const [membership] = await tx
      .insert(memberships)
      .values({
        userId: user.id,
        workspaceId: workspace.id,
        organizationId,
        roleId: role.id,
        dataScope: input.dataScope,
      })
      .returning({ id: memberships.id });

    if (membership === undefined) {
      throw new Error("Membership insert returned no row");
    }

    await emitAuditEvent(tx, {
      type: AUDIT_EVENTS.organizationCreated,
      actor: { type: ACTOR_TYPES.user, userId: user.id },
      subject: { type: "organization", id: organizationId },
      organizationId,
      workspaceId: workspace.id,
      request: input.request,
      after: {
        organization: {
          id: organizationId,
          name: organization.name,
          slug: input.organization.slug,
          tenancy: input.organization.tenancy,
        },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        },
        owner: {
          userId: user.id,
          roleSlug: role.slug,
          dataScope: input.dataScope,
        },
        registrationMethod: "self_serve",
      },
    });

    await emitAuditEvent(tx, {
      type: AUDIT_EVENTS.emailVerificationRequested,
      actor: { type: ACTOR_TYPES.user, userId: user.id },
      subject: { type: "user", id: user.id },
      organizationId,
      workspaceId: workspace.id,
      request: input.request,
      after: {
        expiresAt: input.verification.expiresAt.toISOString(),
        trigger: "registration",
      },
    });

    return {
      userId: user.id,
      organizationId,
      workspaceId: workspace.id,
    };
  });
}

async function verifyEmailAndStartSession(input: {
  readonly emailNormalized: string;
  readonly codeHash: string;
  readonly maxAttempts: number;
  readonly now: Date;
  readonly session: { readonly expiresAt: Date };
  readonly refreshToken: {
    readonly tokenHash: string;
    readonly expiresAt: Date;
  };
  readonly request: RequestMetadata;
}): Promise<VerifyEmailOutcome> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.emailNormalized, input.emailNormalized))
      .limit(1);

    if (account === undefined) {
      return { outcome: "no_pending_code" };
    }

    const [credential] = await tx
      .select({
        id: credentials.id,
        codeHash: credentials.emailVerificationTokenHash,
        expiresAt: credentials.emailVerificationExpiresAt,
        consumedAt: credentials.emailVerificationConsumedAt,
        attempts: credentials.emailVerificationAttempts,
      })
      .from(credentials)
      .where(eq(credentials.userId, account.userId))
      .for("update")
      .limit(1);

    if (
      credential === undefined ||
      credential.codeHash === null ||
      credential.expiresAt === null ||
      credential.consumedAt !== null
    ) {
      return { outcome: "no_pending_code" };
    }

    if (credential.expiresAt.getTime() <= input.now.getTime()) {
      return { outcome: "expired" };
    }

    if (credential.attempts >= input.maxAttempts) {
      return { outcome: "too_many_attempts" };
    }

    if (!tokenHashEquals(credential.codeHash, input.codeHash)) {
      const attempts = credential.attempts + 1;
      const exhausted = attempts >= input.maxAttempts;

      await tx
        .update(credentials)
        .set({
          emailVerificationAttempts: attempts,
          ...(exhausted
            ? {
                emailVerificationTokenHash: null,
                emailVerificationExpiresAt: null,
              }
            : {}),
          updatedAt: input.now,
        })
        .where(eq(credentials.id, credential.id));

      return exhausted
        ? { outcome: "too_many_attempts" }
        : {
            outcome: "invalid",
            attemptsRemaining: input.maxAttempts - attempts,
          };
    }

    const scope = await resolvePrimaryScope(tx, account.userId);

    if (scope === undefined) {
      throw new Error(
        `No active membership for user ${account.userId} — cannot establish a session scope`,
      );
    }

    await setTenantScope(tx, {
      organizationId: scope.organization_id,
      workspaceId: scope.workspace_id,
    });

    await tx
      .update(credentials)
      .set({
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        emailVerificationConsumedAt: input.now,
        emailVerificationAttempts: 0,
        updatedAt: input.now,
      })
      .where(eq(credentials.id, credential.id));

    await tx
      .update(users)
      .set({ emailVerifiedAt: input.now, updatedAt: input.now })
      .where(eq(users.id, account.userId));

    const [organization] = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        tenancy: organizations.tenancy,
      })
      .from(organizations)
      .where(eq(organizations.id, scope.organization_id))
      .limit(1);

    const [workspace] = await tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
      })
      .from(workspaces)
      .where(eq(workspaces.id, scope.workspace_id))
      .limit(1);

    if (organization === undefined || workspace === undefined) {
      throw new Error("Tenant scope resolved to rows that RLS then hid");
    }

    const [session] = await tx
      .insert(sessions)
      .values({
        userId: account.userId,
        organizationId: scope.organization_id,
        workspaceId: scope.workspace_id,
        expiresAt: input.session.expiresAt,
        userAgent: input.request.userAgent ?? null,
        ipAddress: input.request.ipAddress ?? null,
      })
      .returning({ id: sessions.id });

    if (session === undefined) {
      throw new Error("Session insert returned no row");
    }

    const refreshTokenId = await nextId(tx);
    await tx.insert(refreshTokens).values({
      id: refreshTokenId,
      familyId: refreshTokenId,
      parentId: null,
      sessionId: session.id,
      userId: account.userId,
      tokenHash: input.refreshToken.tokenHash,
      expiresAt: input.refreshToken.expiresAt,
    });

    await emitAuditEvent(tx, {
      type: AUDIT_EVENTS.emailVerified,
      actor: { type: ACTOR_TYPES.user, userId: account.userId },
      subject: { type: "user", id: account.userId },
      organizationId: scope.organization_id,
      workspaceId: scope.workspace_id,
      request: input.request,
      before: { emailVerified: false },
      after: { emailVerified: true, sessionId: session.id },
    });

    return {
      outcome: "verified",
      user: {
        id: account.userId,
        email: account.email,
        fullName: account.fullName,
        emailVerified: true,
      },
      organization,
      workspace,
      membership: {
        id: scope.membership_id,
        roleId: scope.role_id,
        roleSlug: scope.role_slug,
        dataScope: scope.data_scope as DataScope,
        permissionVersion: scope.permission_version,
      },
      session: { id: session.id },
    };
  });
}

async function reissueVerificationCode(input: {
  readonly emailNormalized: string;
  readonly verification: VerificationCodeRecord;
  readonly cooldownSeconds: number;
  readonly now: Date;
  readonly request: RequestMetadata;
}): Promise<ReissueOutcome> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ userId: users.id, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.emailNormalized, input.emailNormalized))
      .limit(1);

    if (account === undefined || account.emailVerifiedAt !== null) {
      return { outcome: "no_such_pending_user" };
    }

    const [credential] = await tx
      .select({
        id: credentials.id,
        sentAt: credentials.emailVerificationSentAt,
      })
      .from(credentials)
      .where(eq(credentials.userId, account.userId))
      .for("update")
      .limit(1);

    if (credential === undefined) {
      return { outcome: "no_such_pending_user" };
    }

    if (credential.sentAt !== null) {
      const elapsedSeconds =
        (input.now.getTime() - credential.sentAt.getTime()) / 1000;

      if (elapsedSeconds < input.cooldownSeconds) {
        return {
          outcome: "cooling_down",
          retryAfterSeconds: Math.ceil(input.cooldownSeconds - elapsedSeconds),
        };
      }
    }

    await tx
      .update(credentials)
      .set({
        emailVerificationTokenHash: input.verification.codeHash,
        emailVerificationExpiresAt: input.verification.expiresAt,
        emailVerificationSentAt: input.now,
        emailVerificationAttempts: 0,
        emailVerificationConsumedAt: null,
        updatedAt: input.now,
      })
      .where(eq(credentials.id, credential.id));

    const scope = await resolvePrimaryScope(tx, account.userId);

    if (scope !== undefined) {
      await setTenantScope(tx, {
        organizationId: scope.organization_id,
        workspaceId: scope.workspace_id,
      });

      await emitAuditEvent(tx, {
        type: AUDIT_EVENTS.emailVerificationRequested,
        actor: { type: ACTOR_TYPES.user, userId: account.userId },
        subject: { type: "user", id: account.userId },
        organizationId: scope.organization_id,
        workspaceId: scope.workspace_id,
        request: input.request,
        after: {
          expiresAt: input.verification.expiresAt.toISOString(),
          trigger: "resend",
        },
      });
    }

    return { outcome: "reissued" };
  });
}

export const authenticationRepository: AuthenticationRepository = {
  findUserIdByEmail,
  provisionTenant,
  verifyEmailAndStartSession,
  reissueVerificationCode,
};
