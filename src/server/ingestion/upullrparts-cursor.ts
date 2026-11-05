import { z } from "zod";
import { UPULLRPARTS_LOCATIONS } from "./upullrparts-make-crawl";

const source = z.literal("upullrparts");
const StoreIdsSchema = z.array(z.number().int().positive()).max(16);

/**
 * Crawl: resume `location` after the last fully crawled make (null before
 * the first). `storesSeen` accumulates stores that reported vehicles, so the
 * final chunk can reject a crawl that silently missed a yard.
 */
export const UpullRPartsCursorSchema = z.discriminatedUnion("phase", [
  z
    .object({
      source,
      phase: z.literal("crawl"),
      location: z.enum(UPULLRPARTS_LOCATIONS),
      afterMake: z.string().min(1).max(100).nullable(),
      storesSeen: StoreIdsSchema,
    })
    .strict(),
  z
    .object({
      source,
      phase: z.literal("complete"),
      storesSeen: StoreIdsSchema,
    })
    .strict(),
]);
export type UpullRPartsCursor = z.infer<typeof UpullRPartsCursorSchema>;

export const UpullRPartsCursor = {
  initial: {
    source: "upullrparts",
    phase: "crawl",
    location: "1",
    afterMake: null,
    storesSeen: [],
  },
} as const satisfies { initial: UpullRPartsCursor };
