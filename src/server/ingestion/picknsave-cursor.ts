import { z } from "zod";

export const PICKNSAVE_PAGE_SIZE = 25;
export const PICKNSAVE_MAX_PRODUCTS = 10_000;
export const PickNSaveYardCodeSchema = z.enum([
  "PNS-VA-LYNCHBURG",
  "PNS-VA-ROANOKE",
]);
const source = z.literal("picknsave");
export const PickNSaveCursorSchema = z.discriminatedUnion("phase", [
  z.object({ source, phase: z.literal("start") }).strict(),
  z
    .object({
      source,
      phase: z.literal("page"),
      page: z
        .number()
        .int()
        .min(2)
        .max(PICKNSAVE_MAX_PRODUCTS / PICKNSAVE_PAGE_SIZE),
      totalProducts: z.number().int().positive().max(PICKNSAVE_MAX_PRODUCTS),
      lastProductId: z.number().int().positive().safe(),
      yardsSeen: z.array(PickNSaveYardCodeSchema).max(2),
    })
    .strict(),
  z.object({ source, phase: z.literal("complete") }).strict(),
]);
export type PickNSaveCursor = z.infer<typeof PickNSaveCursorSchema>;
export const PickNSaveCursor = {
  initial: { source: "picknsave", phase: "start" },
} as const satisfies { initial: PickNSaveCursor };
