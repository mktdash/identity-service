import { describe, expect, it } from "vitest";
import {
  isUnsafeLogKey,
  REDACT_PATHS,
  REDACTED,
  sanitizeUrl,
  truncate,
} from "#observability/redaction";

describe("REDACT_PATHS", () => {
  it("has no duplicates — pino throws on a repeated path", () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });

  it("covers both camelCase and snake_case spellings of a credential", () => {
    expect(REDACT_PATHS).toContain("refreshToken");
    expect(REDACT_PATHS).toContain("refresh_token");
    expect(REDACT_PATHS).toContain("*.refreshToken");
    expect(REDACT_PATHS).toContain("*.refresh_token");
  });

  it("redacts ioredis command arguments and postgres bound parameters", () => {
    expect(REDACT_PATHS).toContain("err.command.args");
    expect(REDACT_PATHS).toContain("*.command.args");
    expect(REDACT_PATHS).toContain("err.parameters");
    expect(REDACT_PATHS).toContain("err.query");
  });

  it("redacts a one-time code inside a body but not a top-level error code", () => {
    expect(REDACT_PATHS).toContain("req.body.code");
    expect(REDACT_PATHS).not.toContain("code");
    expect(REDACT_PATHS).not.toContain("*.code");
  });
});

describe("isUnsafeLogKey", () => {
  it("treats spelling variants of one credential as one decision", () => {
    for (const key of [
      "accessToken",
      "access_token",
      "Access-Token",
      "ACCESSTOKEN",
    ]) {
      expect(isUnsafeLogKey(key)).toBe(true);
    }
  });

  it("rejects the structural fields drivers park caller data in", () => {
    for (const key of ["parameters", "args", "rows", "detail", "where"]) {
      expect(isUnsafeLogKey(key)).toBe(true);
    }
  });

  it("allows ordinary diagnostic fields", () => {
    for (const key of ["statusCode", "route", "durationMs", "event"]) {
      expect(isUnsafeLogKey(key)).toBe(false);
    }
  });
});

describe("sanitizeUrl", () => {
  it("censors every query value while keeping the parameter names", () => {
    expect(sanitizeUrl("/v1/auth/verify-email?token=abc123&next=/home")).toBe(
      `/v1/auth/verify-email?token=${REDACTED}&next=${REDACTED}`,
    );
  });

  it("masks a token-shaped path segment", () => {
    expect(
      sanitizeUrl("/v1/invitations/pQ8vN2xL9yT4wR7mK1jH5bF3dS6gA0zC"),
    ).toBe(`/v1/invitations/${REDACTED}`);
  });

  it("keeps identifiers readable", () => {
    const url = "/v1/workspaces/018f3b2c-4a5d-7e11-9c3f-2b6a8d4e1f07/members";
    expect(sanitizeUrl(url)).toBe(url);
  });

  it("leaves an ordinary path untouched", () => {
    expect(sanitizeUrl("/v1/me/permissions")).toBe("/v1/me/permissions");
  });

  it("drops the fragment", () => {
    expect(sanitizeUrl("/accept-invite#token=abc")).toBe("/accept-invite");
  });
});

describe("truncate", () => {
  it("bounds a string that came from outside the process", () => {
    const result = truncate("x".repeat(1000));
    expect(result.length).toBeLessThan(600);
    expect(result.endsWith("[truncated]")).toBe(true);
  });

  it("leaves a short string alone", () => {
    expect(truncate("short")).toBe("short");
  });
});
