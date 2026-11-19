import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { SourceValidationPolicy } from "./source-validation";

export const WHITEBRADSTREET_PAGE_SIZE = 25;
export const WHITEBRADSTREET_MAX_PAGES = 400;
/** Durable cooldowns after HTTP 429 outlasts the in-chunk retries. Each one
 * waits at least this long, or the host's longer Retry-After. */
export const WHITEBRADSTREET_RATE_LIMIT_COOLDOWNS_MS = [
  2 * 60 * 1000,
  5 * 60 * 1000,
  10 * 60 * 1000,
] as const;
/** Every cooldown in one crawl must end within an hour of the first. */
export const WHITEBRADSTREET_MAX_DEFERRAL_MS = 60 * 60 * 1000;
const timestamp = z.number().int().nonnegative().safe();
/** Present once a crawl has deferred a rate limit; carried to later checkpoints. */
const rateLimit = z
  .object({
    since: timestamp,
    deferrals: z
      .number()
      .int()
      .min(1)
      .max(WHITEBRADSTREET_RATE_LIMIT_COOLDOWNS_MS.length),
  })
  .strict();
/** The durable Workflow sleeps until retryAt before the next chunk. */
const deferral = {
  rateLimit: rateLimit.optional(),
  retryAt: timestamp.optional(),
};
const count = z.number().int().nonnegative().max(10_000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[1-9]\d{0,11}$/);
const vin = z
  .string()
  .min(5)
  .max(17)
  .refine(
    (value) =>
      inventoryVin(value, value.length === 17 ? "1981" : "1980") === value,
  );
const seen = z.discriminatedUnion("status", [
  z
    .object({ id, status: z.literal("available"), vin, identity: hash })
    .strict(),
  z
    .object({ id, status: z.literal("duplicate"), vin, identity: hash })
    .strict(),
  z
    .object({
      id,
      status: z.literal("incomplete"),
      vin: vin.nullable(),
      identity: z.null(),
    })
    .strict(),
]);
export type WhitebradstreetSeen = z.infer<typeof seen>;
export type WhitebradstreetRateLimit = z.infer<typeof rateLimit>;
export const WhitebradstreetCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("whitebradstreet"),
        phase: z.literal("start"),
        ...deferral,
      })
      .strict(),
    z
      .object({
        source: z.literal("whitebradstreet"),
        phase: z.literal("pages"),
        nextPage: z.number().int().min(2).max(WHITEBRADSTREET_MAX_PAGES),
        total: count.positive(),
        processed: count,
        emitted: count,
        rejected: count,
        duplicates: count,
        seen: z.array(seen).min(25).max(10_000),
        hashes: z.array(hash).min(1).max(WHITEBRADSTREET_MAX_PAGES),
        ...deferral,
      })
      .strict(),
    z
      .object({
        source: z.literal("whitebradstreet"),
        phase: z.literal("complete"),
      })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "complete") return;
    if (
      cursor.retryAt === undefined
        ? cursor.phase === "start" && cursor.rateLimit !== undefined
        : cursor.rateLimit === undefined ||
          cursor.retryAt <= cursor.rateLimit.since ||
          cursor.retryAt >
            cursor.rateLimit.since + WHITEBRADSTREET_MAX_DEFERRAL_MS
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "White & Bradstreet cooldown is not bound to a recorded rate limit inside its one-hour deferral window; retain the last validated checkpoint",
      });
    if (cursor.phase !== "pages") return;
    const accepted = new Map<string, string>();
    let identitiesValid = true;
    for (const row of cursor.seen) {
      if (row.status === "available") {
        if (accepted.has(row.vin)) identitiesValid = false;
        accepted.set(row.vin, row.identity);
      } else if (
        row.status === "duplicate" &&
        accepted.get(row.vin) !== row.identity
      )
        identitiesValid = false;
    }
    if (
      cursor.nextPage > Math.ceil(cursor.total / 25) ||
      cursor.processed !== (cursor.nextPage - 1) * 25 ||
      cursor.processed >= cursor.total ||
      cursor.seen.length !== cursor.processed ||
      cursor.emitted !==
        cursor.seen.filter((row) => row.status === "available").length ||
      cursor.rejected !==
        cursor.seen.filter((row) => row.status === "incomplete").length ||
      cursor.duplicates !==
        cursor.seen.filter((row) => row.status === "duplicate").length ||
      cursor.processed !==
        cursor.emitted + cursor.rejected + cursor.duplicates ||
      cursor.hashes.length !== cursor.nextPage - 1 ||
      new Set(cursor.hashes).size !== cursor.hashes.length ||
      new Set(cursor.seen.map((row) => row.id)).size !== cursor.seen.length ||
      !identitiesValid ||
      cursor.rejected / cursor.total >
        SourceValidationPolicy.maximumRejectionRatio ||
      cursor.duplicates / cursor.total >
        SourceValidationPolicy.maximumDuplicateRatio
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "White & Bradstreet checkpoint page coverage, donor identities or cumulative counters are inconsistent; retain the last validated checkpoint",
      });
  });
export type WhitebradstreetCursor = z.infer<typeof WhitebradstreetCursorSchema>;
export const WhitebradstreetCursor = {
  initial: { source: "whitebradstreet", phase: "start" },
} as const satisfies { initial: WhitebradstreetCursor };
