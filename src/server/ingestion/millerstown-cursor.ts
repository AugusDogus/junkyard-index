import { z } from "zod";

export const MillerstownCursorSchema = z.discriminatedUnion("phase", [
  z
    .object({ source: z.literal("millerstown"), phase: z.literal("start") })
    .strict(),
  z
    .object({ source: z.literal("millerstown"), phase: z.literal("complete") })
    .strict(),
]);
export type MillerstownCursor = z.infer<typeof MillerstownCursorSchema>;
export const MillerstownCursor = {
  initial: { source: "millerstown", phase: "start" },
} as const satisfies { initial: MillerstownCursor };
