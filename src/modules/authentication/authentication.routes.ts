import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { RATE_LIMITS } from "#config/constants";
import {
  register,
  resendVerification,
  verifyEmail,
} from "./authentication.controller.ts";
import {
  problemDetailsSchema,
  registerBodySchema,
  registerResponseSchema,
  resendVerificationBodySchema,
  resendVerificationResponseSchema,
  verifyEmailBodySchema,
  verifyEmailResponseSchema,
} from "./authentication.dto.ts";

export const authenticationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/register",
    {
      config: {
        public: true,
        rateLimit: {
          max: RATE_LIMITS.register.max,
          timeWindow: RATE_LIMITS.register.windowMs,
        },
      },
      schema: {
        operationId: "registerOrganization",
        tags: ["authentication"],
        summary: "Self-serve sign-up — creates the tenant and emails a code",
        description:
          "Creates an organization, its first workspace, the owning user and their credential, and a membership binding that user to the workspace with the Super Admin role — in one transaction. Returns NO tokens: the account is unusable until the email address is verified. Responds 202 and issues a six-digit verification code.",
        body: registerBodySchema,
        response: {
          202: registerResponseSchema,
          400: problemDetailsSchema,
          409: problemDetailsSchema,
          429: problemDetailsSchema,
          500: problemDetailsSchema,
        },
      },
    },
    register,
  );

  app.post(
    "/verify-email",
    {
      config: {
        public: true,
        rateLimit: {
          max: RATE_LIMITS.verifyEmail.max,
          timeWindow: RATE_LIMITS.verifyEmail.windowMs,
        },
      },
      schema: {
        operationId: "verifyEmail",
        tags: ["authentication"],
        summary: "Consume a verification code, completing sign-up",
        description:
          "Verifies the address, establishes a session and issues the token pair. POST, never GET: link-scanning proxies (Outlook Safe Links, Gmail's fetcher, corporate scanners) will fetch a URL before the human does, and a GET that consumes a single-use code produces 'the link doesn't work' reports nobody can reproduce.",
        body: verifyEmailBodySchema,
        response: {
          200: verifyEmailResponseSchema,
          400: problemDetailsSchema,
          410: problemDetailsSchema,
          429: problemDetailsSchema,
          500: problemDetailsSchema,
        },
      },
    },
    verifyEmail,
  );

  app.post(
    "/verify-email/resend",
    {
      config: {
        public: true,
        rateLimit: {
          max: RATE_LIMITS.resendVerification.max,
          timeWindow: RATE_LIMITS.resendVerification.windowMs,
        },
      },
      schema: {
        operationId: "resendVerificationCode",
        tags: ["authentication"],
        summary: "Reissue a verification code",
        description:
          "Always responds 202 with the cooldown, whether or not the address exists or is already verified — answering truthfully would make this an account-existence oracle. The 60-second cooldown is enforced under a row lock regardless of the response.",
        body: resendVerificationBodySchema,
        response: {
          202: resendVerificationResponseSchema,
          400: problemDetailsSchema,
          429: problemDetailsSchema,
          500: problemDetailsSchema,
        },
      },
    },
    resendVerification,
  );
};
