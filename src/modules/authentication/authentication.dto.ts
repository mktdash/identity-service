import { z } from "zod";
import {
  DATA_SCOPES,
  EMAIL_VERIFICATION,
  EMAIL_MAX_LENGTH,
  FULL_NAME_LIMITS,
  PASSWORD_POLICY,
  TENANCY_MODES,
  WORKSPACE_NAME_LIMITS,
} from "#config/constants";

const passwordSchema = z
  .string()
  .min(
    PASSWORD_POLICY.minLength,
    `Use at least ${PASSWORD_POLICY.minLength} characters`,
  )
  .max(
    PASSWORD_POLICY.maxLength,
    `Use at most ${PASSWORD_POLICY.maxLength} characters`,
  );

const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your work email")
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email("Enter a valid email address"));

export const registerBodySchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(FULL_NAME_LIMITS.min, "Enter your full name")
      .max(FULL_NAME_LIMITS.max),
    email: emailSchema,
    password: passwordSchema,
    workspaceName: z
      .string()
      .trim()
      .min(WORKSPACE_NAME_LIMITS.min, "Give your workspace a name")
      .max(WORKSPACE_NAME_LIMITS.max),
    tenancy: z.enum(TENANCY_MODES),
  })
  .strict();

export type RegisterBody = z.output<typeof registerBodySchema>;

export const registerResponseSchema = z.object({
  status: z.literal("verification-required"),
  email: z
    .string()
    .describe("Echoed back so the client can route to /verify-email?email=…"),
  expiresInSeconds: z
    .number()
    .int()
    .describe("Lifetime of the verification code just issued."),
  resendAvailableInSeconds: z
    .number()
    .int()
    .describe("Cooldown before a resend will be accepted."),
});

export type RegisterResponse = z.output<typeof registerResponseSchema>;

export const verifyEmailBodySchema = z
  .object({
    email: emailSchema,
    code: z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/gu, ""))
      .pipe(
        z
          .string()
          .regex(
            new RegExp(`^\\d{${EMAIL_VERIFICATION.codeLength}}$`, "u"),
            `Enter the ${EMAIL_VERIFICATION.codeLength}-digit code from your email`,
          ),
      ),
  })
  .strict();

export type VerifyEmailBody = z.output<typeof verifyEmailBodySchema>;

const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  emailVerified: z.boolean(),
});

const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  tenancy: z.enum(TENANCY_MODES),
});

const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
});

const membershipSchema = z.object({
  id: z.uuid(),
  roleId: z.uuid(),
  roleSlug: z.string(),
  dataScope: z.enum(DATA_SCOPES),
  permissionVersion: z.number().int(),
});

const tokenPairSchema = z.object({
  accessToken: z
    .string()
    .describe("EdDSA (Ed25519) JWT. Send as a Bearer token."),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().describe("Access token lifetime in seconds."),
  refreshToken: z
    .string()
    .describe(
      "Opaque, 256-bit, single-use. Rotated on every refresh; replaying a used token kills the whole family.",
    ),
  refreshExpiresIn: z.number().int(),
});

export const verifyEmailResponseSchema = z.object({
  status: z.literal("verified"),
  redirectTo: z.string(),
  user: userSchema,
  organization: organizationSchema,
  workspace: workspaceSchema,
  membership: membershipSchema,
  tokens: tokenPairSchema,
});

export type VerifyEmailResponse = z.output<typeof verifyEmailResponseSchema>;

export const resendVerificationBodySchema = z
  .object({ email: emailSchema })
  .strict();

export type ResendVerificationBody = z.output<
  typeof resendVerificationBodySchema
>;

export const resendVerificationResponseSchema = z.object({
  status: z.literal("sent"),
  retryAfterSeconds: z.number().int(),
});

export type ResendVerificationResponse = z.output<
  typeof resendVerificationResponseSchema
>;

export const problemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z
      .string()
      .describe("Stable, machine-readable. Branch on this, never on `detail`."),
    detail: z.string(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe("Field paths only — the submitted value is never echoed back."),
  })
  .describe("RFC 9457 Problem Details");
