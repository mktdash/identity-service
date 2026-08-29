import { describe, expect, it } from "vitest";
import { PROBE_ROUTES } from "#config/constants";
import {
  levelFor,
  REQUEST_COMPLETED_EVENT,
  shouldLogRequest,
} from "#plugins/request-logging.plugin";

describe("request logging — probe filtering", () => {
  it("drops healthy probe traffic so it cannot dominate the index", () => {
    for (const route of PROBE_ROUTES) {
      expect(shouldLogRequest(route, 200)).toBe(false);
      expect(shouldLogRequest(route, 204)).toBe(false);
    }
  });

  it("keeps a failing probe — a degraded readiness check is the point of the index", () => {
    expect(shouldLogRequest("/ready", 503)).toBe(true);
    expect(shouldLogRequest("/health", 500)).toBe(true);
  });

  it("never drops real traffic, including a healthy auth request", () => {
    expect(shouldLogRequest("/v1/auth/register", 202)).toBe(true);
    expect(shouldLogRequest("/.well-known/jwks.json", 200)).toBe(true);
    expect(shouldLogRequest("unmatched", 404)).toBe(true);
  });
});

describe("request logging — level mapping", () => {
  it("logs client errors at warn so auth failures are never sampled away at info", () => {
    expect(levelFor(400)).toBe("warn");
    expect(levelFor(401)).toBe("warn");
    expect(levelFor(403)).toBe("warn");
    expect(levelFor(429)).toBe("warn");
  });

  it("logs server errors at error", () => {
    expect(levelFor(500)).toBe("error");
    expect(levelFor(503)).toBe("error");
  });

  it("logs successful traffic at info", () => {
    expect(levelFor(200)).toBe("info");
    expect(levelFor(302)).toBe("info");
  });
});

describe("request logging — the event field", () => {
  it("is stable, so an alert can be built on it", () => {
    expect(REQUEST_COMPLETED_EVENT).toBe("request_completed");
  });
});
