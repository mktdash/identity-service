import { AppError } from "#lib/errors/app-error";
import { ERROR_CODES } from "#lib/errors/codes";

export class SigningKeyUnavailableError extends AppError {
  constructor(reason: string, cause?: unknown) {
    super({
      status: 503,
      code: ERROR_CODES.signingKeyUnavailable,
      title: "Signing key unavailable",
      detail:
        "The token signing key could not be published. Retry after the interval in the Retry-After header.",
      headers: { "retry-after": "30", "cache-control": "no-store" },
      logContext: {
        reason,
        remediation:
          "check JWT_SIGNING_KEY in the secret store; regenerate with `pnpm key:generate`",
      },
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
