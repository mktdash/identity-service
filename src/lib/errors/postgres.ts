const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

type PostgresErrorShape = {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const code = (error as PostgresErrorShape).code;
  return typeof code === "string" ? code : undefined;
}

export function constraintName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const name = (error as PostgresErrorShape).constraint_name;
  return typeof name === "string" ? name : undefined;
}

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (errorCode(error) !== UNIQUE_VIOLATION) {
    return false;
  }

  return constraint === undefined || constraintName(error) === constraint;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === FOREIGN_KEY_VIOLATION;
}

export function isCheckViolation(error: unknown): boolean {
  return errorCode(error) === CHECK_VIOLATION;
}
