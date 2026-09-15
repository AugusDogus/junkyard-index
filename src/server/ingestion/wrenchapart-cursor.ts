import { z } from "zod";

export const WrenchApartCursorSchema = z.object({
  source: z.literal("wrenchapart"),
  afterLocationId: z.number().int().nonnegative().safe(),
});
export type WrenchApartCursor = z.infer<typeof WrenchApartCursorSchema>;
export const WrenchApartCursor = {
  initial: { source: "wrenchapart", afterLocationId: 0 },
} as const satisfies { initial: WrenchApartCursor };
