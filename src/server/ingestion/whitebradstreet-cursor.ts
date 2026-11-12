import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { SourceValidationPolicy } from "./source-validation";

export const WHITEBRADSTREET_PAGE_SIZE = 25;
export const WHITEBRADSTREET_MAX_PAGES = 400;
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
export const WhitebradstreetCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("whitebradstreet"),
        phase: z.literal("start"),
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
