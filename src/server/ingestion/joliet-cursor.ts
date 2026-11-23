import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import {
  JOLIET_MAX_QUERIES,
  JOLIET_MAX_STOCKS,
  JolietStockSchema,
  jolietHash,
} from "./joliet-parser";
import { VinplusYearSchema } from "./vinplus-protocol";

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
  year: VinplusYearSchema,
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
/** Restarts one run may take after the official context changes mid-crawl.
 * A source that keeps changing still fails instead of crawling forever. */
export const JOLIET_MAX_RESTARTS = 2;
const restarts = z.number().int().min(1).max(JOLIET_MAX_RESTARTS);
interface JolietProgress {
  contextHash: string;
  restarts: number;
  nextQuery: number;
  pairCount: number;
  seen: readonly JolietSeen[];
  receipts: readonly { hash: string; count: number; newStocks: number }[];
}
/** Detect corruption of trusted internal state, without relying on JSON key order.
 * This checksum is not cursor authentication.
 */
function progressHash(
  progress: Omit<JolietProgress, "restarts"> & { restarts?: number },
): string {
  return jolietHash({
    // Omitted at zero so checkpoints written before restarts keep their hash.
    ...(progress.restarts ? { restarts: progress.restarts } : {}),
    contextHash: progress.contextHash,
    nextQuery: progress.nextQuery,
    pairCount: progress.pairCount,
    seen: progress.seen.map((entry) => ({
      stock: entry.stock,
      year: entry.year,
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
        // Absent at zero, so checkpoints written before restarts round-trip
        // byte for byte through the guarded durable update.
        restarts: restarts.optional(),
        nextQuery: z
          .number()
          .int()
          .min(1)
          .max(JOLIET_MAX_QUERIES - 1),
        pairCount: z.number().int().min(2).max(JOLIET_MAX_QUERIES),
        seen: z.array(seenSchema).max(JOLIET_MAX_STOCKS),
        receipts: z
          .array(
            z
              .object({
                hash,
                count: z.number().int().nonnegative().max(JOLIET_MAX_STOCKS),
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
    // The official context changed; the next chunk crawls it from query 0.
    z
      .object({
        source: z.literal("joliet"),
        phase: z.literal("restart"),
        restarts,
      })
      .strict(),
    // A restarted run records its restarts, so code that predates restarts
    // rejects the terminal cursor instead of publishing superseded chunks.
    z
      .object({
        source: z.literal("joliet"),
        phase: z.literal("complete"),
        restarts: restarts.optional(),
      })
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
  checkpoint({ restarts, ...progress }: JolietProgress): JolietCursor {
    return JolietCursorSchema.parse({
      source: "joliet",
      phase: "queries",
      ...progress,
      ...(restarts ? { restarts } : {}),
      progressHash: progressHash({ ...progress, restarts }),
    });
  },
} as const satisfies {
  initial: JolietCursor;
  checkpoint: (progress: JolietProgress) => JolietCursor;
};
