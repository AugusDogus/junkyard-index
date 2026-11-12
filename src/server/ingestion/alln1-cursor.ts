import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import {
  ALLN1_MAX_PAGES,
  ALLN1_MAX_RECORDS,
  ALLN1_PAGE_SIZE,
  alln1PageNumber,
} from "./alln1-yard-metadata";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const vin = z
  .string()
  .min(5)
  .max(17)
  .refine(
    (value) =>
      inventoryVin(value, value.length === 17 ? "1981" : "1980") === value,
  );
const stock = z
  .string()
  .regex(/^(?!0+$)[A-Z0-9][A-Z0-9-]{1,39}$/i)
  .nullable();
const seenFields = {
  hash,
  stock,
  firstPage: z.number().int().min(1).max(ALLN1_MAX_PAGES),
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
  z
    .object({
      ...seenFields,
      status: z.literal("quarantined"),
      vin: vin.nullable(),
      position: z.enum(["HOLD", "YARD VAN", "REBUILDER"]),
    })
    .strict(),
]);
export type Alln1Seen = z.infer<typeof seenSchema>;
interface Alln1Progress {
  scopeHash: string;
  anchorHash: string;
  lastPage: number;
  nextPage: number;
  nextUrl: string;
  seen: readonly Alln1Seen[];
  receipts: readonly { hash: string; count: number }[];
}
/** Corruption detection for trusted internal durable state, not authentication. */
function progressHash(progress: Alln1Progress): string {
  const value = {
    scopeHash: progress.scopeHash,
    anchorHash: progress.anchorHash,
    lastPage: progress.lastPage,
    nextPage: progress.nextPage,
    nextUrl: progress.nextUrl,
    seen: progress.seen.map((entry) => ({
      hash: entry.hash,
      stock: entry.stock,
      firstPage: entry.firstPage,
      status: entry.status,
      vin: entry.vin,
      position: entry.status === "quarantined" ? entry.position : null,
    })),
    receipts: progress.receipts.map((entry) => ({
      hash: entry.hash,
      count: entry.count,
    })),
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export const Alln1CursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("alln1"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        source: z.literal("alln1"),
        phase: z.literal("pages"),
        scopeHash: hash,
        anchorHash: hash,
        progressHash: hash,
        lastPage: z.number().int().min(2).max(ALLN1_MAX_PAGES),
        nextPage: z.number().int().min(2).max(ALLN1_MAX_PAGES),
        nextUrl: z.string().max(1000),
        seen: z.array(seenSchema).min(ALLN1_PAGE_SIZE).max(ALLN1_MAX_RECORDS),
        receipts: z
          .array(z.object({ hash, count: z.literal(ALLN1_PAGE_SIZE) }).strict())
          .min(1)
          .max(ALLN1_MAX_PAGES - 1),
      })
      .strict(),
    z
      .object({ source: z.literal("alln1"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "pages") return;
    const vins = cursor.seen.flatMap((entry) => (entry.vin ? [entry.vin] : []));
    const stocks = cursor.seen.flatMap((entry) =>
      entry.stock ? [entry.stock] : [],
    );
    const perPage = new Map<number, number>();
    for (const entry of cursor.seen)
      perPage.set(entry.firstPage, (perPage.get(entry.firstPage) ?? 0) + 1);
    if (
      cursor.progressHash !== progressHash(cursor) ||
      cursor.nextPage > cursor.lastPage ||
      alln1PageNumber(cursor.nextUrl) !== cursor.nextPage ||
      cursor.receipts.length !== cursor.nextPage - 1 ||
      cursor.seen.length !== (cursor.nextPage - 1) * ALLN1_PAGE_SIZE ||
      new Set(vins).size !== vins.length ||
      new Set(stocks).size !== stocks.length ||
      new Set(cursor.receipts.map((r) => r.hash)).size !==
        cursor.receipts.length ||
      cursor.seen.some((r) => r.firstPage >= cursor.nextPage) ||
      cursor.receipts.some((r, i) => perPage.get(i + 1) !== r.count)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "All-N-1 checkpoint page coverage, identities or integrity is inconsistent; retain the last validated checkpoint",
      });
  });
export type Alln1Cursor = z.infer<typeof Alln1CursorSchema>;
export const Alln1Cursor = {
  initial: { source: "alln1", phase: "start" },
  checkpoint(progress: Alln1Progress): Alln1Cursor {
    return Alln1CursorSchema.parse({
      source: "alln1",
      phase: "pages",
      ...progress,
      progressHash: progressHash(progress),
    });
  },
} as const satisfies {
  initial: Alln1Cursor;
  checkpoint: (progress: Alln1Progress) => Alln1Cursor;
};
