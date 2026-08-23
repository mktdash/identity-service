import { checkDatabaseConnection } from "#db/client";
import { checkRedisConnection } from "#lib/redis/client";
import type { LivenessResponse, ReadinessResponse } from "./health.dto.ts";

export function getLiveness(serviceName: string): LivenessResponse {
  return {
    status: "ok",
    service: serviceName,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

export async function getReadiness(): Promise<ReadinessResponse> {
  const [postgres, redis] = await Promise.all([
    checkDatabaseConnection().then(
      () => "up" as const,
      () => "down" as const,
    ),
    checkRedisConnection().then(
      () => "up" as const,
      () => "down" as const,
    ),
  ]);

  return {
    status: postgres === "up" && redis === "up" ? "ready" : "degraded",
    checks: { postgres, redis },
  };
}
