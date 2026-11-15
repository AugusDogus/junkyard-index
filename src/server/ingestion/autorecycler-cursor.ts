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
      phase: z.literal("ario"),
      yardIndex: z.number().int().min(0).max(19),
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
