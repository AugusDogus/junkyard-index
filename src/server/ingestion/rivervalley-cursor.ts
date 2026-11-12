import { z } from "zod";
import { inventoryVin } from "./inventory-vin";

export const RIVERVALLEY_PAGE_SIZE = 25;
export const RIVERVALLEY_MAX_PAGES = 400;
const count = z
  .number()
  .int()
  .nonnegative()
  .max(RIVERVALLEY_PAGE_SIZE * RIVERVALLEY_MAX_PAGES);
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
export type RivervalleySeen = z.infer<typeof seen>;
const progress = {
  source: z.literal("rivervalley"),
  total: count.positive(),
  processed: count,
  emitted: count,
  rejected: count,
  duplicates: count,
  seen: z.array(seen).max(RIVERVALLEY_MAX_PAGES * RIVERVALLEY_PAGE_SIZE),
  hashes: z.array(hash).min(1).max(RIVERVALLEY_MAX_PAGES),
};
export const RivervalleyCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("rivervalley"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        ...progress,
        phase: z.literal("pages"),
        nextPage: z.number().int().min(2).max(RIVERVALLEY_MAX_PAGES),
      })
      .strict(),
    z
      .object({
        ...progress,
        phase: z.literal("verify"),
        verifyPage: z.number().int().min(1).max(RIVERVALLEY_MAX_PAGES),
      })
      .strict(),
    z
      .object({
        source: z.literal("rivervalley"),
        phase: z.literal("complete"),
      })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "pages" && cursor.phase !== "verify") return;
    const lastPage = Math.ceil(cursor.total / RIVERVALLEY_PAGE_SIZE);
    const completedPages =
      cursor.phase === "pages" ? cursor.nextPage - 1 : lastPage;
    const coverageValid =
      cursor.phase === "pages"
        ? cursor.nextPage <= lastPage &&
          cursor.processed === completedPages * RIVERVALLEY_PAGE_SIZE &&
          cursor.processed < cursor.total
        : cursor.verifyPage <= lastPage && cursor.processed === cursor.total;
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
      !coverageValid ||
      cursor.seen.length !== cursor.processed ||
      cursor.emitted !==
        cursor.seen.filter((row) => row.status === "available").length ||
      cursor.rejected !==
        cursor.seen.filter((row) => row.status === "incomplete").length ||
      cursor.duplicates !==
        cursor.seen.filter((row) => row.status === "duplicate").length ||
      cursor.processed !==
        cursor.emitted + cursor.rejected + cursor.duplicates ||
      cursor.hashes.length !== completedPages ||
      new Set(cursor.hashes).size !== cursor.hashes.length ||
      new Set(cursor.seen.map((row) => row.id)).size !== cursor.seen.length ||
      !identitiesValid
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "River Valley checkpoint page coverage, donor identities or cumulative counters are inconsistent; retain the last validated checkpoint",
      });
  });
export type RivervalleyCursor = z.infer<typeof RivervalleyCursorSchema>;
export const RivervalleyCursor = {
  initial: { source: "rivervalley", phase: "start" },
} as const satisfies { initial: RivervalleyCursor };
