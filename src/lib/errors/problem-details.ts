import { z } from "zod";

export const problemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z
      .string()
      .describe("Stable, machine-readable. Branch on this, never on `detail`."),
    detail: z.string(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe("Field paths only — the submitted value is never echoed back."),
  })
  .describe("RFC 9457 Problem Details");
