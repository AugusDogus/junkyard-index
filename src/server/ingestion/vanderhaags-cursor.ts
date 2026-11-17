import { z } from "zod";

const source = z.literal("vanderhaags");
export const VanderHaagsCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ source, phase: z.literal("start") }).strict(),
    z.object({ source, phase: z.literal("complete") }).strict(),
    z
      .object({
        source,
        phase: z.literal("details"),
        catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
        offset: z.number().int().positive().max(10_000),
        rejected: z.number().int().nonnegative().max(10_000),
        seenVins: z.array(z.string().regex(/^[A-Z0-9]{5,17}$/)).max(10_000),
      })
      .strict(),
  ])
  .refine(
    (c) =>
      c.phase !== "details" ||
      (c.rejected <= c.offset &&
        c.seenVins.length <= c.offset &&
        c.seenVins.length >= c.offset - c.rejected &&
        new Set(c.seenVins).size === c.seenVins.length),
    "Vander Haags progress does not reconcile with observed identities",
  );
export type VanderHaagsCursor = z.infer<typeof VanderHaagsCursorSchema>;
export const VanderHaagsCursor = {
  initial: { source: "vanderhaags", phase: "start" },
} as const satisfies { initial: VanderHaagsCursor };
