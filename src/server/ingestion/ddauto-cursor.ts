import { z } from "zod";

export const DdautoCursorSchema = z.discriminatedUnion("phase", [
  z.object({ source: z.literal("ddauto"), phase: z.literal("start") }).strict(),
  z
    .object({ source: z.literal("ddauto"), phase: z.literal("complete") })
    .strict(),
]);
export type DdautoCursor = z.infer<typeof DdautoCursorSchema>;
export const DdautoCursor = {
  initial: { source: "ddauto", phase: "start" },
} as const satisfies { initial: DdautoCursor };
