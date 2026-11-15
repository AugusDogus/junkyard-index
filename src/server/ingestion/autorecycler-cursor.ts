import { z } from "zod";
import { AutorecyclerFreshnessSchema } from "./autorecycler-freshness-state";

export const AutorecyclerRecordIdSchema = z.string().regex(/^\d+x\d+$/);

export const AutorecyclerCursorSchema = z.discriminatedUnion("phase", [
  z
    .object({
      source: z.literal("autorecycler"),
      phase: z.literal("freshness"),
    })
    .strict(),
  z
    .object({
      source: z.literal("autorecycler"),
      phase: z.literal("ario-read"),
      offset: z.number().int().min(0).max(100_100).multipleOf(100),
      closing: z.boolean(),
      statePath: z.string().min(1).nullable(),
      retryAt: z.number().int().nonnegative().optional(),
      freshness: AutorecyclerFreshnessSchema,
    })
    .strict(),
  z
    .object({
      source: z.literal("autorecycler"),
      phase: z.literal("ario"),
      yardIndex: z.number().int().min(0).max(19),
      statePath: z.string().min(1).optional(),
      freshness: AutorecyclerFreshnessSchema.optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal("autorecycler"),
      phase: z.literal("page"),
      beforeId: AutorecyclerRecordIdSchema.nullable(),
      freshness: AutorecyclerFreshnessSchema.optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal("autorecycler"),
      phase: z.literal("complete"),
      freshness: AutorecyclerFreshnessSchema.optional(),
    })
    .strict(),
]);

export type AutorecyclerCursor = z.infer<typeof AutorecyclerCursorSchema>;

export const AutorecyclerCursor = {
  initial: { source: "autorecycler", phase: "page", beforeId: null },
} as const satisfies { initial: AutorecyclerCursor };
