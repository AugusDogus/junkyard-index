import { z } from "zod";
import { UPULLRPARTS_LOCATIONS } from "./upullrparts-make-crawl";

const source = z.literal("upullrparts");
const StoreIdsSchema = z.array(z.number().int().positive()).max(16);

const label = z.string().min(1).max(100);

/** A chunk whose canary finds getVehicles blocking the function's IP pauses
 * at its cursor until this long later; a block lasts over an hour. */
export const UPULLRPARTS_BLOCK_RETRY_MS = 45 * 60_000;
/** Every retry of one block is due within this long of its first empty
 * canary, so a lasting block opens at most four browser sessions. */
export const UPULLRPARTS_MAX_BLOCK_MS = 3 * 60 * 60_000;
const timestamp = z.number().int().nonnegative().safe();
/** Present while a block lasts: `blockedSince` is the first empty canary, and
 * the durable workflow sleeps until `retryAt` before the next chunk. */
const block = {
  blockedSince: timestamp.optional(),
  retryAt: timestamp.optional(),
};

/**
 * Crawl: resume `location` after the last fully crawled make (null before
 * the first). Split: resume `make` at `location` after its models up to
 * `model`, in label order, and of `model` only after the years up to `year`
 * when it is not null. `storesSeen` accumulates stores that reported
 * vehicles, so the final chunk can reject a crawl that silently missed a yard.
 */
export const UpullRPartsCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source,
        phase: z.literal("crawl"),
        location: z.enum(UPULLRPARTS_LOCATIONS),
        afterMake: label.nullable(),
        storesSeen: StoreIdsSchema,
        ...block,
      })
      .strict(),
    z
      .object({
        source,
        phase: z.literal("split"),
        location: z.enum(UPULLRPARTS_LOCATIONS),
        make: label,
        model: label,
        year: z
          .string()
          .regex(/^\d{4}$/)
          .nullable(),
        storesSeen: StoreIdsSchema,
        ...block,
      })
      .strict(),
    z
      .object({
        source,
        phase: z.literal("complete"),
        storesSeen: StoreIdsSchema,
      })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "complete") return;
    const { blockedSince, retryAt } = cursor;
    if (blockedSince === undefined && retryAt === undefined) return;
    if (
      blockedSince === undefined ||
      retryAt === undefined ||
      retryAt <= blockedSince ||
      retryAt > blockedSince + UPULLRPARTS_MAX_BLOCK_MS
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "U Pull R Parts block wait needs blockedSince and a later retryAt within the block limit; retain the last validated checkpoint",
      });
  });
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
