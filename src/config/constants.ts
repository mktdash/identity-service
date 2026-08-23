export const TOKEN_TYPES = {
  access: "access",
  refresh: "refresh",
  mfaPending: "mfa_pending",
} as const;

export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

export const JWT_ALGORITHM = "EdDSA";

export const REFRESH_TOKEN_BYTES = 32;

export const ROLE_SLUGS = {
  superAdmin: "super_admin",
  admin: "admin",
  manager: "manager",
  agent: "agent",
  analyst: "analyst",
  clientGuest: "client_guest",
  billingContact: "billing_contact",
} as const;

export type RoleSlug = (typeof ROLE_SLUGS)[keyof typeof ROLE_SLUGS];

export const DATA_SCOPES = [
  "own",
  "team",
  "workspace",
  "organization",
] as const;

export type DataScope = (typeof DATA_SCOPES)[number];

export const ARGON2_PARAMS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
} as const;

export const TENANCY_MODES = ["company", "agency"] as const;

export type TenancyMode = (typeof TENANCY_MODES)[number];

export const EMAIL_VERIFICATION = {
  codeLength: 6,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  ttlSeconds: 15 * 60,
} as const;

export const ORGANIZATION_NAME_LIMITS = { min: 1, max: 120 } as const;
export const WORKSPACE_NAME_LIMITS = { min: 1, max: 120 } as const;
export const FULL_NAME_LIMITS = { min: 1, max: 120 } as const;
export const EMAIL_MAX_LENGTH = 254;

export const FALLBACK_ORGANIZATION_SLUG = "org";
export const FALLBACK_WORKSPACE_SLUG = "workspace";

export const REGISTRATION_DEFAULTS = {
  ownerRoleSlug: ROLE_SLUGS.superAdmin,
  ownerDataScope: "organization",
} as const satisfies { ownerRoleSlug: RoleSlug; ownerDataScope: DataScope };

export const SLUG_MAX_LENGTH = 48;

export const SLUG_SUFFIX_BYTES = 6;

export const RATE_LIMITS = {
  register: { max: 5, windowMs: 10 * 60 * 1000 },
  verifyEmail: { max: 20, windowMs: 10 * 60 * 1000 },
  resendVerification: { max: 6, windowMs: 10 * 60 * 1000 },
} as const;

export const AUDIT_EVENTS = {
  organizationCreated: "organization.created",
  userRegistered: "user.registered",
  emailVerificationRequested: "user.email_verification_requested",
  emailVerified: "user.email_verified",
  emailVerificationFailed: "user.email_verification_failed",
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

export const ACTOR_TYPES = {
  user: "user",
  system: "system",
  service: "service",
} as const;

export type ActorType = (typeof ACTOR_TYPES)[keyof typeof ACTOR_TYPES];

export const TENANT_SETTINGS = {
  organizationId: "app.organization_id",
  workspaceId: "app.workspace_id",
} as const;
