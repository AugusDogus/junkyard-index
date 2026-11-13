import { z } from "zod";

export const MeeksCursorSchema = z.discriminatedUnion("phase", [
  z.object({ source: z.literal("meeks"), phase: z.literal("start") }).strict(),
  z
    .object({ source: z.literal("meeks"), phase: z.literal("complete") })
    .strict(),
]);
export type MeeksCursor = z.infer<typeof MeeksCursorSchema>;
export const MeeksCursor = {
  initial: { source: "meeks", phase: "start" },
} as const satisfies { initial: MeeksCursor };
