import { z } from "zod";

export const ArmyCursorSchema = z.discriminatedUnion("phase", [
  z.object({ source: z.literal("army"), phase: z.literal("start") }).strict(),
  z
    .object({ source: z.literal("army"), phase: z.literal("complete") })
    .strict(),
]);
export type ArmyCursor = z.infer<typeof ArmyCursorSchema>;
export const ArmyCursor = {
  initial: { source: "army", phase: "start" },
} as const satisfies { initial: ArmyCursor };
