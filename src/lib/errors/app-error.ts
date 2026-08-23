import { errorTypeUri, type ErrorCode } from "./codes.ts";

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  instance?: string;
  requestId?: string;
  errors?: readonly { path: string; message: string }[];
};

export type AppErrorOptions = {
  readonly status: number;
  readonly code: ErrorCode;
  readonly title: string;
  readonly detail: string;
  readonly cause?: unknown;
  readonly logContext?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
};

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly title: string;
  readonly detail: string;
  readonly logContext: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;

  constructor(options: AppErrorOptions) {
    super(
      options.detail,
      options.cause === undefined ? {} : { cause: options.cause },
    );
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.title = options.title;
    this.detail = options.detail;
    this.logContext = options.logContext ?? {};
    this.headers = options.headers ?? {};
  }

  toProblemDetails(instance?: string, requestId?: string): ProblemDetails {
    const problem: ProblemDetails = {
      type: errorTypeUri(this.code),
      title: this.title,
      status: this.status,
      code: this.code,
      detail: this.detail,
    };

    if (instance !== undefined) {
      problem.instance = instance;
    }

    if (requestId !== undefined) {
      problem.requestId = requestId;
    }

    return problem;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
