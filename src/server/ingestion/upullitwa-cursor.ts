import { z } from "zod";

export const UPULLITWA_MAX_PAGES_PER_YARD = 100;
export const UpullitwaYardIdSchema = z.string().regex(/^[A-Z0-9]{4}$/);
const source = z.literal("upullitwa");
export const UpullitwaCursorSchema = z.discriminatedUnion("phase", [
  z.object({ source, phase: z.literal("start") }).strict(),
  z
    .object({
      source,
      phase: z.literal("page"),
      yardId: UpullitwaYardIdSchema,
      page: z.number().int().min(1).max(UPULLITWA_MAX_PAGES_PER_YARD),
      declaredPageCount: z
        .number()
        .int()
        .nonnegative()
        .max(UPULLITWA_MAX_PAGES_PER_YARD),
      completedYardIds: z.array(UpullitwaYardIdSchema).max(32),
      pageFingerprints: z
        .array(z.string().regex(/^[a-f0-9]{64}$/))
        .max(UPULLITWA_MAX_PAGES_PER_YARD),
      usableYardVehicles: z
        .number()
        .int()
        .nonnegative()
        .max(UPULLITWA_MAX_PAGES_PER_YARD * 1_000),
    })
    .strict(),
  z.object({ source, phase: z.literal("complete") }).strict(),
]);
export type UpullitwaCursor = z.infer<typeof UpullitwaCursorSchema>;
export const UpullitwaCursor = {
  initial: { source: "upullitwa", phase: "start" },
} as const satisfies { initial: UpullitwaCursor };
