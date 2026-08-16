import { describe, expect, it } from "vitest";
import { REDACTED } from "#observability/redaction";
import {
  errorSerializer,
  requestSerializer,
  responseSerializer,
} from "#observability/serializers";

describe("requestSerializer", () => {
  const request = {
    id: "01J8ZQ",
    method: "POST",
    url: "/v1/auth/token/refresh?token=super-secret-value",
    ip: "203.0.113.7",
    routeOptions: { url: "/v1/auth/token/refresh" },
    headers: {
      authorization: "Bearer eyJhbGciOiJFZERTQSJ9.payload.signature",
      cookie: "session=abc",
      "x-api-key": "sk_live_123",
      "x-amz-security-token": "a-header-nobody-anticipated",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
      "x-request-id": "01J8ZQ",
    },
    body: { password: "hunter2" },
  };

  const serialized = requestSerializer(request);

  it("keeps only allowlisted headers", () => {
    expect(serialized.headers).toEqual({
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
      "x-request-id": "01J8ZQ",
    });
  });

  it("drops a credential header nobody thought to deny", () => {
    expect(JSON.stringify(serialized)).not.toContain(
      "a-header-nobody-anticipated",
    );
  });

  it("never serialises the body", () => {
    expect(serialized).not.toHaveProperty("body");
    expect(JSON.stringify(serialized)).not.toContain("hunter2");
  });

  it("records the route template alongside the sanitised URL", () => {
    expect(serialized.route).toBe("/v1/auth/token/refresh");
    expect(serialized.url).toBe(`/v1/auth/token/refresh?token=${REDACTED}`);
  });

  it("uses the trustProxy-resolved client address", () => {
    expect(serialized.remoteAddress).toBe("203.0.113.7");
  });

  it("survives a non-object input", () => {
    expect(requestSerializer(undefined)).toEqual({});
  });
});

describe("responseSerializer", () => {
  it("reads headers through Fastify's getHeaders() and drops set-cookie", () => {
    const reply = {
      statusCode: 401,
      getHeaders: () => ({
        "content-type": "application/problem+json",
        "cache-control": "no-store",
        "set-cookie": "session=abc; HttpOnly",
      }),
    };

    expect(responseSerializer(reply)).toEqual({
      statusCode: 401,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "no-store",
      },
    });
  });

  it("sanitises a redirect Location that carries a token", () => {
    const reply = {
      statusCode: 302,
      headers: { location: "/accept-invite?token=abc123" },
    };

    expect(responseSerializer(reply).headers?.["location"]).toBe(
      `/accept-invite?token=${REDACTED}`,
    );
  });
});

describe("errorSerializer", () => {
  it("keeps the diagnostic fields", () => {
    const error = Object.assign(new TypeError("boom"), { code: "ERR_BOOM" });
    const serialized = errorSerializer(error);

    expect(serialized.type).toBe("TypeError");
    expect(serialized.message).toBe("boom");
    expect(serialized["code"]).toBe("ERR_BOOM");
    expect(typeof serialized.stack).toBe("string");
  });

  it("drops a postgres statement and its bound parameters", () => {
    const error = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint_name: "users_email_normalized_unique",
      table_name: "users",
      query: "insert into credentials (password_hash) values ($1)",
      parameters: ["$argon2id$v=19$m=19456,t=2,p=1$realhash"],
      detail: "Key (email)=(person@example.com) already exists.",
    });

    const serialized = errorSerializer(error);
    const json = JSON.stringify(serialized);

    expect(serialized["code"]).toBe("23505");
    expect(serialized["constraint_name"]).toBe("users_email_normalized_unique");
    expect(json).not.toContain("argon2id");
    expect(json).not.toContain("insert into");
    expect(json).not.toContain("person@example.com");
  });

  it("keeps the redis command name and drops every argument", () => {
    const error = Object.assign(new Error("Command timed out"), {
      command: {
        name: "get",
        args: ["identity:pv:018f3b2c", "a-session-token-hash"],
      },
    });

    const serialized = errorSerializer(error);

    expect(serialized["command"]).toEqual({ name: "get" });
    expect(JSON.stringify(serialized)).not.toContain("a-session-token-hash");
  });

  it("follows the cause chain", () => {
    const root = new Error("ECONNREFUSED");
    const wrapper = new Error("redis unavailable", { cause: root });

    expect(errorSerializer(wrapper).cause?.message).toBe("ECONNREFUSED");
  });

  it("does not recurse forever on a cyclic cause", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    Object.defineProperty(first, "cause", { value: second, enumerable: false });

    expect(() => errorSerializer(second)).not.toThrow();
  });

  it("handles a thrown non-Error", () => {
    expect(errorSerializer("just a string")).toEqual({
      type: "string",
      message: "just a string",
    });
  });
});
