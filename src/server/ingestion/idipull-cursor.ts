import { z } from "zod";

export const IdipullCursorSchema = z.discriminatedUnion("phase", [
  z
    .object({ source: z.literal("idipull"), phase: z.literal("start") })
    .strict(),
  z
    .object({ source: z.literal("idipull"), phase: z.literal("complete") })
    .strict(),
]);
export type IdipullCursor = z.infer<typeof IdipullCursorSchema>;
export const IdipullCursor = {
  initial: { source: "idipull", phase: "start" },
} as const satisfies { initial: IdipullCursor };
