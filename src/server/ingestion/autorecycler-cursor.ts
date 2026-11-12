import { z } from "zod";

export const AutorecyclerRecordIdSchema = z.string().regex(/^\d+x\d+$/);

export const AutorecyclerCursorSchema = z.discriminatedUnion("phase", [
  z
    .object({
      source: z.literal("autorecycler"),
      phase: z.literal("page"),
      beforeId: AutorecyclerRecordIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      source: z.literal("autorecycler"),
      phase: z.literal("complete"),
    })
    .strict(),
]);

export type AutorecyclerCursor = z.infer<typeof AutorecyclerCursorSchema>;

export const AutorecyclerCursor = {
  initial: { source: "autorecycler", phase: "page", beforeId: null },
} as const satisfies { initial: AutorecyclerCursor };
