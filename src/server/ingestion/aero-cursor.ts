import { z } from "zod";

export const AeroCursorSchema = z.discriminatedUnion("phase", [
  z.object({ source: z.literal("aero"), phase: z.literal("start") }).strict(),
  z
    .object({ source: z.literal("aero"), phase: z.literal("complete") })
    .strict(),
]);
export type AeroCursor = z.infer<typeof AeroCursorSchema>;
export const AeroCursor = {
  initial: { source: "aero", phase: "start" },
} as const satisfies { initial: AeroCursor };
