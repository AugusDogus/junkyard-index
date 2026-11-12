import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import {
  JOLIET_MAX_QUERIES,
  JOLIET_MAX_STOCKS,
  JolietStockSchema,
  jolietHash,
} from "./joliet-parser";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const vin = z
  .string()
  .min(5)
  .max(17)
  .refine(
    (value) =>
      inventoryVin(value, value.length === 17 ? "1981" : "1980") === value,
  );
const stockFields = {
  stock: JolietStockSchema,
  hash,
  firstQuery: z
    .number()
    .int()
    .nonnegative()
    .max(JOLIET_MAX_QUERIES - 1),
};
const seenSchema = z.discriminatedUnion("status", [
  z.object({ ...stockFields, status: z.literal("available"), vin }).strict(),
  z
    .object({
      ...stockFields,
      status: z.literal("incomplete"),
      vin: vin.nullable(),
    })
    .strict(),
]);
export type JolietSeen = z.infer<typeof seenSchema>;
interface JolietProgress {
  contextHash: string;
  nextQuery: number;
  pairCount: number;
  seen: readonly JolietSeen[];
  receipts: readonly { hash: string; count: number; newStocks: number }[];
}
/** Detect corruption of trusted internal state, without relying on JSON key order.
 * This checksum is not cursor authentication.
 */
function progressHash(progress: JolietProgress): string {
  return jolietHash({
    contextHash: progress.contextHash,
    nextQuery: progress.nextQuery,
    pairCount: progress.pairCount,
    seen: progress.seen.map((entry) => ({
      stock: entry.stock,
      hash: entry.hash,
      firstQuery: entry.firstQuery,
      status: entry.status,
      vin: entry.vin,
    })),
    receipts: progress.receipts.map((entry) => ({
      hash: entry.hash,
      count: entry.count,
      newStocks: entry.newStocks,
    })),
  });
}
export const JolietCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("joliet"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        source: z.literal("joliet"),
        phase: z.literal("queries"),
        contextHash: hash,
        progressHash: hash,
        nextQuery: z
          .number()
          .int()
          .min(1)
          .max(JOLIET_MAX_QUERIES - 1),
        pairCount: z.number().int().min(2).max(JOLIET_MAX_QUERIES),
        seen: z.array(seenSchema).min(1).max(JOLIET_MAX_STOCKS),
        receipts: z
          .array(
            z
              .object({
                hash,
                count: z.number().int().positive().max(JOLIET_MAX_STOCKS),
                newStocks: z
                  .number()
                  .int()
                  .nonnegative()
                  .max(JOLIET_MAX_STOCKS),
              })
              .strict(),
          )
          .min(1)
          .max(JOLIET_MAX_QUERIES - 1),
      })
      .strict(),
    z
      .object({ source: z.literal("joliet"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "queries") return;
    const vins = cursor.seen.flatMap((entry) => (entry.vin ? [entry.vin] : []));
    const firstCounts = new Map<number, number>();
    for (const entry of cursor.seen)
      firstCounts.set(
        entry.firstQuery,
        (firstCounts.get(entry.firstQuery) ?? 0) + 1,
      );
    if (
      cursor.progressHash !== progressHash(cursor) ||
      cursor.nextQuery >= cursor.pairCount ||
      cursor.receipts.length !== cursor.nextQuery ||
      new Set(cursor.seen.map((entry) => entry.stock)).size !==
        cursor.seen.length ||
      new Set(vins).size !== vins.length ||
      new Set(cursor.receipts.map((entry) => entry.hash)).size !==
        cursor.receipts.length ||
      cursor.seen.some((entry) => entry.firstQuery >= cursor.nextQuery) ||
      cursor.receipts.some(
        (entry, index) =>
          entry.newStocks > entry.count ||
          entry.newStocks !== (firstCounts.get(index) ?? 0),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Joliet checkpoint query coverage, native stocks, identities or accounting is inconsistent; retain the last validated checkpoint",
      });
    }
  });
export type JolietCursor = z.infer<typeof JolietCursorSchema>;
export const JolietCursor = {
  initial: { source: "joliet", phase: "start" },
  checkpoint(progress: JolietProgress): JolietCursor {
    return JolietCursorSchema.parse({
      source: "joliet",
      phase: "queries",
      ...progress,
      progressHash: progressHash(progress),
    });
  },
} as const satisfies {
  initial: JolietCursor;
  checkpoint: (progress: JolietProgress) => JolietCursor;
};
