import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import { isProduction } from "#config/env";
import { isAppError, type ProblemDetails } from "#lib/errors/app-error";
import { ERROR_CODES, errorTypeUri, type ErrorCode } from "#lib/errors/codes";
import { securityLogger } from "#observability/logger";

const PROBLEM_JSON = "application/problem+json";

type ProblemInput = {
  readonly status: number;
  readonly code: ErrorCode;
  readonly title: string;
  readonly detail: string;
  readonly errors?: readonly { path: string; message: string }[];
};

function problem(request: FastifyRequest, input: ProblemInput): ProblemDetails {
  const body: ProblemDetails = {
    type: errorTypeUri(input.code),
    title: input.title,
    status: input.status,
    code: input.code,
    detail: input.detail,
    instance: request.url.split("?", 1)[0] ?? request.url,
    requestId: request.ctx.requestId,
  };

  if (input.errors !== undefined) {
    body.errors = input.errors;
  }

  return body;
}

function validationProblem(
  request: FastifyRequest,
  error: FastifyError,
): ProblemDetails {
  const issues = hasZodFastifySchemaValidationErrors(error)
    ? error.validation.map((issue) => ({
        path: issue.instancePath.replace(/^\//u, "").replaceAll("/", "."),
        message: issue.message ?? "Invalid value.",
      }))
    : [];

  return problem(request, {
    status: 400,
    code: ERROR_CODES.validationFailed,
    title: "Validation failed",
    detail: "The request body or parameters did not match the expected schema.",
    errors: issues,
  });
}

const STATUS_MAP: ReadonlyMap<
  number,
  { code: ErrorCode; title: string; detail: string }
> = new Map([
  [
    400,
    {
      code: ERROR_CODES.malformedRequest,
      title: "Malformed request",
      detail: "The request could not be parsed.",
    },
  ],
  [
    404,
    {
      code: ERROR_CODES.notFound,
      title: "Not found",
      detail: "No resource exists at this address.",
    },
  ],
  [
    405,
    {
      code: ERROR_CODES.methodNotAllowed,
      title: "Method not allowed",
      detail: "This method is not supported for this resource.",
    },
  ],
  [
    406,
    {
      code: ERROR_CODES.notAcceptable,
      title: "Not acceptable",
      detail: "This endpoint cannot produce the representation you requested.",
    },
  ],
  [
    413,
    {
      code: ERROR_CODES.payloadTooLarge,
      title: "Payload too large",
      detail: "The request body exceeded the maximum accepted size.",
    },
  ],
  [
    415,
    {
      code: ERROR_CODES.unsupportedMediaType,
      title: "Unsupported media type",
      detail: "This endpoint accepts application/json.",
    },
  ],
  [
    429,
    {
      code: ERROR_CODES.rateLimited,
      title: "Too many requests",
      detail:
        "Rate limit exceeded. Retry after the interval in the Retry-After header.",
    },
  ],
]);

async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .type(PROBLEM_JSON)
      .send(
        problem(request, {
          status: 404,
          code: ERROR_CODES.notFound,
          title: "Not found",
          detail: "No resource exists at this address.",
        }),
      );
  });

  app.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      if (hasZodFastifySchemaValidationErrors(error)) {
        void reply
          .code(400)
          .type(PROBLEM_JSON)
          .send(validationProblem(request, error));
        return;
      }

      if (isResponseSerializationError(error)) {
        request.log.error(
          {
            err: error,
            event: "response_serialization_failed",
            route: request.routeOptions.url,
          },
          "response did not match its declared schema",
        );

        void reply
          .code(500)
          .type(PROBLEM_JSON)
          .send(
            problem(request, {
              status: 500,
              code: ERROR_CODES.internalError,
              title: "Internal server error",
              detail: "The server failed to produce a valid response.",
            }),
          );
        return;
      }

      if (isAppError(error)) {
        for (const [header, value] of Object.entries(error.headers)) {
          void reply.header(header, value);
        }

        const isSecurityEvent =
          error.status === 401 || error.status === 403 || error.status === 429;
        const log = isSecurityEvent ? securityLogger : request.log;
        log[error.status >= 500 ? "error" : "warn"](
          {
            err: error,
            event: error.code,
            status: error.status,
            ...error.logContext,
          },
          error.title,
        );

        void reply
          .code(error.status)
          .type(PROBLEM_JSON)
          .send(
            error.toProblemDetails(
              request.url.split("?", 1)[0],
              request.ctx.requestId,
            ),
          );
        return;
      }

      const status =
        typeof error.statusCode === "number" ? error.statusCode : 500;
      const mapped = STATUS_MAP.get(status);

      if (mapped !== undefined && status < 500) {
        request.log.warn(
          { err: error, event: mapped.code, status },
          mapped.title,
        );

        void reply
          .code(status)
          .type(PROBLEM_JSON)
          .send(problem(request, { status, ...mapped }));
        return;
      }

      request.log.error(
        {
          err: error,
          event: ERROR_CODES.internalError,
          status,
          route: request.routeOptions.url,
        },
        "unhandled error",
      );

      void reply
        .code(status >= 500 ? 500 : status)
        .type(PROBLEM_JSON)
        .send(
          problem(request, {
            status: status >= 500 ? 500 : status,
            code: ERROR_CODES.internalError,
            title: "Internal server error",
            detail: isProduction
              ? "Something went wrong. Quote the requestId when reporting this."
              : `Something went wrong (${error.name}). Check the server log for requestId ${request.ctx.requestId}.`,
          }),
        );
    },
  );
}

export default fp(errorHandlerPlugin, {
  name: "error-handler",
  fastify: "5.x",
  dependencies: ["request-context"],
});
