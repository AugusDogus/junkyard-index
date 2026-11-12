import { z } from "zod";

export const RightwayCursorSchema = z.discriminatedUnion("phase", [
  z
    .object({ source: z.literal("rightway"), phase: z.literal("start") })
    .strict(),
  z
    .object({ source: z.literal("rightway"), phase: z.literal("complete") })
    .strict(),
]);
export type RightwayCursor = z.infer<typeof RightwayCursorSchema>;
export const RightwayCursor = {
  initial: { source: "rightway", phase: "start" },
} as const satisfies { initial: RightwayCursor };
