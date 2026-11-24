import { z } from "zod";
import {
  UPULLRPARTS_LOCATIONS,
  UPULLRPARTS_SEARCH_LIMIT,
} from "./upullrparts-date-crawl";

const source = z.literal("upullrparts");
const StoreIdsSchema = z.array(z.number().int().positive()).max(16);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
/** Shared by every searching chunk: the run's end date (`today`, the UTC
 * day its directory was loaded), the directory's snapshot path (set by the
 * repository's checkpoint, null only until then) and the stores that have
 * reported vehicles, so the final chunk can reject a crawl that silently
 * missed a yard. */
const crawling = {
  source,
  location: z.enum(UPULLRPARTS_LOCATIONS),
  today: day,
  statePath: z.string().min(1).max(256).nullable(),
  storesSeen: StoreIdsSchema,
  ...block,
};

/**
 * Directory: load getMakes and getModels for the run. Crawl: search
 * `location`'s arrivals from `end` back to the first day, every later
 * arrival up to `today` having been accepted. Split: `day` alone filled a
 * search at `location`, so it is searched make by make after `afterMake`;
 * `missing` are that full search's rows no make has returned yet.
 */
export const UpullRPartsCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source,
        phase: z.literal("directory"),
        storesSeen: StoreIdsSchema,
      })
      .strict(),
    z.object({ ...crawling, phase: z.literal("crawl"), end: day }).strict(),
    z
      .object({
        ...crawling,
        phase: z.literal("split"),
        day,
        afterMake: label.nullable(),
        missing: z.array(label).max(UPULLRPARTS_SEARCH_LIMIT),
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
    if (cursor.phase === "complete" || cursor.phase === "directory") return;
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
  initial: { source: "upullrparts", phase: "directory", storesSeen: [] },
} as const satisfies { initial: UpullRPartsCursor };
