import { z } from "zod";

export const livenessResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.string(),
    uptimeSeconds: z.number(),
  })
  .describe("Process liveness. Never reflects dependency health.");

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.object({
    postgres: z.enum(["up", "down"]),
    redis: z.enum(["up", "down"]),
  }),
});

export type LivenessResponse = z.output<typeof livenessResponseSchema>;
export type ReadinessResponse = z.output<typeof readinessResponseSchema>;
