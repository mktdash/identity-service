import { Writable } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";
import { REDACTED } from "../redaction.ts";
import { runWithRequestContext } from "../request-context.ts";

process.env["NODE_ENV"] = "test";
process.env["SERVICE_NAME"] ??= "test-identity-service";
process.env["DATABASE_HOST"] ??= "localhost";
process.env["DATABASE_NAME"] ??= "test";
process.env["DATABASE_USER"] ??= "test";
process.env["DATABASE_PASSWORD"] ??= "test";
process.env["REDIS_HOST"] ??= "localhost";

type CreateLogger = typeof import("../logger.ts").createLogger;

let createLogger: CreateLogger;

beforeAll(async () => {
  ({ createLogger } = await import("../logger.ts"));
});

type Captured = {
  lines: Record<string, unknown>[];
  stream: Writable;
};

function capture(): Captured {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });

  return { lines, stream };
}

describe("createLogger", () => {
  it("emits JSON with the configured service name", () => {
    const { lines, stream } = capture();
    createLogger({ destination: stream, serviceName: "svc-under-test" }).info(
      { event: "startup" },
      "hello",
    );

    expect(lines[0]).toMatchObject({
      service: "svc-under-test",
      environment: "test",
      level: "info",
      event: "startup",
      msg: "hello",
    });
    expect(typeof lines[0]?.["time"]).toBe("string");
  });

  it("redacts a credential wherever it sits in the log object", () => {
    const { lines, stream } = capture();
    const log = createLogger({ destination: stream });

    log.info({
      refreshToken: "rt_live_abc",
      grant: { access_token: "at_live_def" },
      body: { password: "hunter2" },
    });

    expect(lines[0]).toMatchObject({
      refreshToken: REDACTED,
      grant: { access_token: REDACTED },
      body: { password: REDACTED },
    });
  });

  it("wires the error serializer, so a driver error carries no caller data", () => {
    const { lines, stream } = capture();
    const error = Object.assign(new Error("Command timed out"), {
      command: { name: "get", args: ["identity:pv:1", "token-hash"] },
    });

    createLogger({ destination: stream }).error({ err: error }, "redis failed");

    expect(JSON.stringify(lines[0])).not.toContain("token-hash");
    expect(lines[0]?.["err"]).toMatchObject({
      type: "Error",
      message: "Command timed out",
      command: { name: "get" },
    });
  });

  it("wires the request serializer, so no body reaches the line", () => {
    const { lines, stream } = capture();

    createLogger({ destination: stream }).info({
      req: {
        method: "POST",
        url: "/v1/auth/login",
        headers: { authorization: "Bearer abc" },
        body: { password: "hunter2" },
      },
    });

    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("Bearer abc");
  });

  it("correlates a line with the request it was emitted inside", () => {
    const { lines, stream } = capture();
    const log = createLogger({ destination: stream });

    runWithRequestContext({ requestId: "req-9" }, () => {
      log.warn({ event: "permission_denied" }, "denied");
    });

    expect(lines[0]).toMatchObject({
      requestId: "req-9",
      event: "permission_denied",
    });
  });

  it("honours the configured level", () => {
    const { lines, stream } = capture();
    const log = createLogger({ destination: stream, level: "warn" });

    log.debug("invisible");
    log.warn("visible");

    expect(lines).toHaveLength(1);
    expect(lines[0]?.["msg"]).toBe("visible");
  });

  it("accepts an injected mixin for deterministic output", () => {
    const { lines, stream } = capture();
    createLogger({ destination: stream, mixin: () => ({ fixed: 1 }) }).info(
      "x",
    );

    expect(lines[0]).toMatchObject({ fixed: 1 });
    expect(lines[0]).not.toHaveProperty("requestId");
  });
});
