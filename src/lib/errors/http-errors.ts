import { AppError } from "./app-error.ts";
import { ERROR_CODES } from "./codes.ts";

export class RateLimitedError extends AppError {
  constructor(
    retryAfterSeconds: number,
    logContext: Record<string, unknown> = {},
  ) {
    super({
      status: 429,
      code: ERROR_CODES.rateLimited,
      title: "Too many requests",
      detail: `Too many requests from this address. Retry in ${retryAfterSeconds} seconds.`,
      headers: { "retry-after": String(retryAfterSeconds) },
      logContext,
    });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(
    detail = "Authentication is required.",
    logContext: Record<string, unknown> = {},
  ) {
    super({
      status: 401,
      code: ERROR_CODES.unauthenticated,
      title: "Unauthenticated",
      detail,
      headers: { "www-authenticate": 'Bearer realm="mktdash"' },
      logContext,
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    detail = "You do not have permission to perform this action.",
    logContext: Record<string, unknown> = {},
  ) {
    super({
      status: 403,
      code: ERROR_CODES.forbidden,
      title: "Forbidden",
      detail,
      logContext,
    });
  }
}
