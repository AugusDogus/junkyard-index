import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import {
  LITTLETON_MAX_QUERIES,
  LITTLETON_MAX_STOCKS,
  LittletonStockSchema,
  littletonHash,
} from "./littleton-parser";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const vin = z
  .string()
  .min(5)
  .max(17)
  .refine(
    (value) =>
      inventoryVin(value, value.length === 17 ? "1981" : "1980") === value,
  );
const seenFields = {
  stock: LittletonStockSchema,
  hash,
  firstQuery: z
    .number()
    .int()
    .nonnegative()
    .max(LITTLETON_MAX_QUERIES - 1),
};
const seenSchema = z.discriminatedUnion("status", [
  z.object({ ...seenFields, status: z.literal("available"), vin }).strict(),
  z
    .object({
      ...seenFields,
      status: z.literal("incomplete"),
      vin: vin.nullable(),
    })
    .strict(),
]);
export type LittletonSeen = z.infer<typeof seenSchema>;
interface LittletonProgress {
  contextHash: string;
  nextQuery: number;
  pairCount: number;
  seen: readonly LittletonSeen[];
  receipts: readonly { hash: string; count: number; newStocks: number }[];
}
/** Integrity for trusted internal durable state, not cursor authentication.
 * Project every resume field explicitly so JSON property ordering is irrelevant.
 */
function progressHash(progress: LittletonProgress): string {
  return littletonHash({
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
export const LittletonCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("littleton"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        source: z.literal("littleton"),
        phase: z.literal("queries"),
        contextHash: hash,
        progressHash: hash,
        nextQuery: z
          .number()
          .int()
          .min(1)
          .max(LITTLETON_MAX_QUERIES - 1),
        pairCount: z.number().int().min(2).max(LITTLETON_MAX_QUERIES),
        seen: z.array(seenSchema).min(1).max(LITTLETON_MAX_STOCKS),
        receipts: z
          .array(
            z
              .object({
                hash,
                count: z.number().int().positive().max(LITTLETON_MAX_STOCKS),
                newStocks: z
                  .number()
                  .int()
                  .nonnegative()
                  .max(LITTLETON_MAX_STOCKS),
              })
              .strict(),
          )
          .min(1)
          .max(LITTLETON_MAX_QUERIES - 1),
      })
      .strict(),
    z
      .object({ source: z.literal("littleton"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "queries") return;
    const vins = cursor.seen.flatMap((r) => (r.vin ? [r.vin] : []));
    const newStocks = new Map<number, number>();
    for (const entry of cursor.seen)
      newStocks.set(
        entry.firstQuery,
        (newStocks.get(entry.firstQuery) ?? 0) + 1,
      );
    if (
      cursor.progressHash !== progressHash(cursor) ||
      cursor.nextQuery >= cursor.pairCount ||
      cursor.receipts.length !== cursor.nextQuery ||
      new Set(cursor.seen.map((r) => r.stock)).size !== cursor.seen.length ||
      new Set(vins).size !== vins.length ||
      new Set(cursor.receipts.map((r) => r.hash)).size !==
        cursor.receipts.length ||
      cursor.seen.some((r) => r.firstQuery >= cursor.nextQuery) ||
      cursor.receipts.some(
        (r, i) =>
          r.newStocks > r.count || r.newStocks !== (newStocks.get(i) ?? 0),
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Littleton checkpoint query coverage, native stocks, VINs or accounting is inconsistent; retain the last validated checkpoint",
      });
  });
export type LittletonCursor = z.infer<typeof LittletonCursorSchema>;
export const LittletonCursor = {
  initial: { source: "littleton", phase: "start" },
  checkpoint(progress: LittletonProgress): LittletonCursor {
    return LittletonCursorSchema.parse({
      source: "littleton",
      phase: "queries",
      ...progress,
      progressHash: progressHash(progress),
    });
  },
} as const satisfies {
  initial: LittletonCursor;
  checkpoint: (progress: LittletonProgress) => LittletonCursor;
};
