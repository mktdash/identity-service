import { describe, expect, it } from "vitest";
import {
  createRequestId,
  getRequestContext,
  logCorrelation,
  normalizeRequestId,
  parseTraceparent,
  runWithRequestContext,
  setRequestPrincipal,
} from "#observability/request-context";

describe("normalizeRequestId", () => {
  it("adopts the gateway's id", () => {
    expect(normalizeRequestId("01J8ZQ4T7X9K2M")).toBe("01J8ZQ4T7X9K2M");
  });

  it("rejects an id carrying a newline — a forged log record", () => {
    expect(
      normalizeRequestId('abc\n{"level":"info","msg":"forged"}'),
    ).toBeUndefined();
  });

  it("rejects an unbounded id", () => {
    expect(normalizeRequestId("a".repeat(129))).toBeUndefined();
  });

  it("rejects an empty or non-string value", () => {
    expect(normalizeRequestId("")).toBeUndefined();
    expect(normalizeRequestId(undefined)).toBeUndefined();
    expect(normalizeRequestId(42)).toBeUndefined();
  });

  it("takes the first value when the header is repeated", () => {
    expect(normalizeRequestId(["first", "second"])).toBe("first");
  });
});

describe("parseTraceparent", () => {
  it("parses a W3C traceparent", () => {
    expect(
      parseTraceparent(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      ),
    ).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });
  });

  it("rejects the all-zero invalid sentinel", () => {
    expect(
      parseTraceparent(
        "00-00000000000000000000000000000000-0000000000000000-00",
      ),
    ).toBeUndefined();
  });

  it("rejects a malformed header", () => {
    expect(parseTraceparent("not-a-traceparent")).toBeUndefined();
  });
});

describe("request context scope", () => {
  it("is undefined outside a request", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(logCorrelation()).toEqual({});
  });

  it("carries the request id across an await boundary", async () => {
    await runWithRequestContext({ requestId: "req-1" }, async () => {
      await Promise.resolve();
      expect(getRequestContext()?.requestId).toBe("req-1");
    });
  });

  it("attaches the principal once authentication has resolved it", async () => {
    await runWithRequestContext({ requestId: "req-2" }, async () => {
      expect(logCorrelation()).toEqual({ requestId: "req-2" });

      setRequestPrincipal({
        userId: "user-1",
        workspaceId: "ws-1",
        organizationId: undefined,
      });

      expect(logCorrelation()).toEqual({
        requestId: "req-2",
        userId: "user-1",
        workspaceId: "ws-1",
      });
    });
  });

  it("falls back to the adopted traceparent when there is no active span", () => {
    runWithRequestContext(
      { requestId: "req-3", traceId: "a".repeat(32), spanId: "b".repeat(16) },
      () => {
        expect(logCorrelation()).toMatchObject({
          trace_id: "a".repeat(32),
          span_id: "b".repeat(16),
        });
      },
    );
  });

  it("does not leak between sibling scopes", () => {
    runWithRequestContext({ requestId: "req-4" }, () => {
      setRequestPrincipal({ userId: "user-a" });
    });

    runWithRequestContext({ requestId: "req-5" }, () => {
      expect(logCorrelation()).toEqual({ requestId: "req-5" });
    });
  });

  it("setRequestPrincipal is a no-op outside a request", () => {
    expect(() => {
      setRequestPrincipal({ userId: "user-1" });
    }).not.toThrow();
  });
});

describe("createRequestId", () => {
  it("mints a distinct id when the gateway sent none", () => {
    expect(createRequestId()).not.toBe(createRequestId());
  });
});
