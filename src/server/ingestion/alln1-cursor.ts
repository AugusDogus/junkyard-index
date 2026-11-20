import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { alln1SourceDate } from "./alln1-parser";
import {
  ALLN1_MAX_PAGES,
  ALLN1_MAX_RECORDS,
  ALLN1_PAGE_SIZE,
  alln1PageNumber,
  ALLN1_TENANT,
  GRANDPAJOHNS_TENANT,
  type Alln1Tenant,
  type Alln1Source,
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
const setDate = z.string().refine((value) => alln1SourceDate(value) === value);
const runFields = {
  date: setDate,
  hashes: z.array(hash).min(1).max(ALLN1_MAX_RECORDS),
};
/**
 * Set Date ordering of the donors read so far. While the catalog stays
 * ordered, `run` is the Set Date of the last donor read with every distinct
 * census donor of that date (they fill one contiguous run of slots), and
 * `repeats` counts donors of that date shown again at the top of the next
 * page. Closed runs with repeats wait in `ties` for their Set Date search.
 * An unordered catalog can hold no ties: their hidden donors could not be
 * located.
 */
const setDatesSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ordered"),
      run: z
        .object({
          ...runFields,
          repeats: z.number().int().min(0).max(ALLN1_PAGE_SIZE),
        })
        .strict(),
      ties: z
        .array(
          z
            .object({
              ...runFields,
              repeats: z.number().int().min(1).max(ALLN1_PAGE_SIZE),
            })
            .strict(),
        )
        .max(ALLN1_MAX_PAGES - 1),
    })
    .strict(),
  z.object({ status: z.literal("unordered") }).strict(),
]);
export type Alln1SetDates = z.infer<typeof setDatesSchema>;
export type Alln1Tie = Extract<Alln1SetDates, { status: "ordered" }>["run"];
export interface Alln1Receipt {
  hash: string;
  count: number;
  /** Rows that repeated a donor of the previous page at a Set Date tie. */
  repeats: number;
}
/** The census read so far, bound to the opening owner, scope and anchor. */
interface Alln1Ledger {
  scopeHash: string;
  anchorHash: string;
  lastPage: number;
  seen: readonly Alln1Seen[];
  receipts: readonly Alln1Receipt[];
  setDates: Alln1SetDates;
}
/** A census with catalog pages still to read from `nextUrl`. */
interface Alln1Progress extends Alln1Ledger {
  nextPage: number;
  nextUrl: string;
}
const tieValue = (tie: Alln1Tie) => ({
  date: tie.date,
  repeats: tie.repeats,
  hashes: tie.hashes,
});
/** Corruption detection for trusted internal durable state, not authentication. */
function progressHash(
  progress: Alln1Ledger,
  next: { nextPage: number; nextUrl: string } | null,
): string {
  const value = {
    scopeHash: progress.scopeHash,
    anchorHash: progress.anchorHash,
    lastPage: progress.lastPage,
    nextPage: next?.nextPage ?? null,
    nextUrl: next?.nextUrl ?? null,
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
      repeats: entry.repeats,
    })),
    setDates:
      progress.setDates.status === "ordered"
        ? {
            status: progress.setDates.status,
            run: tieValue(progress.setDates.run),
            ties: progress.setDates.ties.map(tieValue),
          }
        : { status: progress.setDates.status },
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export type UpullCursor<S extends Alln1Source> =
  | { source: S; phase: "start" }
  | ({ source: S; phase: "pages"; progressHash: string } & Alln1Progress)
  | ({ source: S; phase: "closing"; progressHash: string } & Alln1Ledger)
  | { source: S; phase: "complete" };

export function createAlln1Cursor<S extends Alln1Source>(
  tenant: Alln1Tenant<S>,
) {
  const schema = z
    .discriminatedUnion("phase", [
      z
        .object({
          source: z.enum(["alln1", "grandpajohns"]),
          phase: z.literal("start"),
        })
        .strict(),
      z
        .object({
          source: z.enum(["alln1", "grandpajohns"]),
          phase: z.literal("pages"),
          scopeHash: hash,
          anchorHash: hash,
          progressHash: hash,
          lastPage: z.number().int().min(2).max(ALLN1_MAX_PAGES),
          nextPage: z.number().int().min(2).max(ALLN1_MAX_PAGES),
          nextUrl: z.string().max(1000),
          seen: z.array(seenSchema).min(ALLN1_PAGE_SIZE).max(ALLN1_MAX_RECORDS),
          receipts: z
            .array(
              z
                .object({
                  hash,
                  count: z.literal(ALLN1_PAGE_SIZE),
                  repeats: z
                    .number()
                    .int()
                    .min(0)
                    .max(ALLN1_PAGE_SIZE - 1),
                })
                .strict(),
            )
            .min(1)
            .max(ALLN1_MAX_PAGES - 1),
          setDates: setDatesSchema,
        })
        .strict(),
      // Every catalog page is admitted; the Set Date searches for its pending
      // ties and the closing owner and first-page reads remain.
      z
        .object({
          source: z.enum(["alln1", "grandpajohns"]),
          phase: z.literal("closing"),
          scopeHash: hash,
          anchorHash: hash,
          progressHash: hash,
          lastPage: z.number().int().min(1).max(ALLN1_MAX_PAGES),
          seen: z.array(seenSchema).min(1).max(ALLN1_MAX_RECORDS),
          receipts: z
            .array(
              z
                .object({
                  hash,
                  count: z.number().int().min(1).max(ALLN1_PAGE_SIZE),
                  repeats: z
                    .number()
                    .int()
                    .min(0)
                    .max(ALLN1_PAGE_SIZE - 1),
                })
                .strict(),
            )
            .min(1)
            .max(ALLN1_MAX_PAGES),
          setDates: setDatesSchema,
        })
        .strict(),
      z
        .object({
          source: z.enum(["alln1", "grandpajohns"]),
          phase: z.literal("complete"),
        })
        .strict(),
    ])
    .superRefine((cursor, context) => {
      if (cursor.source !== tenant.source)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "U-Pull checkpoint belongs to another tenant",
        });
      if (cursor.phase !== "pages" && cursor.phase !== "closing") return;
      const next =
        cursor.phase === "pages"
          ? { nextPage: cursor.nextPage, nextUrl: cursor.nextUrl }
          : null;
      const nextPage = next?.nextPage ?? cursor.lastPage + 1;
      const vins = cursor.seen.flatMap((entry) =>
        entry.vin ? [entry.vin] : [],
      );
      const stocks = cursor.seen.flatMap((entry) =>
        entry.stock ? [entry.stock] : [],
      );
      const perPage = new Map<number, number>();
      for (const entry of cursor.seen)
        perPage.set(entry.firstPage, (perPage.get(entry.firstPage) ?? 0) + 1);
      const seenHashes = new Set(cursor.seen.map((entry) => entry.hash));
      const repeats = cursor.receipts.reduce((sum, r) => sum + r.repeats, 0);
      const runs =
        cursor.setDates.status === "ordered"
          ? [...cursor.setDates.ties, cursor.setDates.run]
          : [];
      const runHashes = runs.flatMap((run) => run.hashes);
      if (
        runs.reduce((sum, run) => sum + run.repeats, 0) !== repeats ||
        runs.some(
          (run, index) =>
            run.repeats > run.hashes.length ||
            (index > 0 && (runs[index - 1]?.date ?? "") <= run.date),
        ) ||
        new Set(runHashes).size !== runHashes.length ||
        runHashes.some((value) => !seenHashes.has(value)) ||
        (cursor.receipts[0]?.repeats ?? 0) !== 0
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "All-N-1 checkpoint Set Date ties disagree with its page receipts or donors; retain the last validated checkpoint",
        });
      if (
        cursor.progressHash !== progressHash(cursor, next) ||
        (next !== null &&
          (next.nextPage > cursor.lastPage ||
            alln1PageNumber(next.nextUrl, tenant) !== next.nextPage)) ||
        cursor.receipts.length !== nextPage - 1 ||
        cursor.receipts
          .slice(0, cursor.lastPage - 1)
          .some((r) => r.count !== ALLN1_PAGE_SIZE) ||
        cursor.seen.length !==
          cursor.receipts.reduce((sum, r) => sum + r.count - r.repeats, 0) ||
        new Set(vins).size !== vins.length ||
        new Set(stocks).size !== stocks.length ||
        new Set(cursor.receipts.map((r) => r.hash)).size !==
          cursor.receipts.length ||
        cursor.seen.some((r) => r.firstPage >= nextPage) ||
        cursor.receipts.some(
          (r, i) => perPage.get(i + 1) !== r.count - r.repeats,
        )
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "All-N-1 checkpoint page coverage, identities or integrity is inconsistent; retain the last validated checkpoint",
        });
    })
    .transform(
      (cursor): UpullCursor<S> => ({ ...cursor, source: tenant.source }),
    );
  type Cursor = UpullCursor<S>;
  return {
    schema,
    initial: { source: tenant.source, phase: "start" } as const,
    checkpoint(progress: Alln1Progress): Cursor {
      return schema.parse({
        source: tenant.source,
        phase: "pages",
        ...progress,
        progressHash: progressHash(progress, progress),
      });
    },
    /** A census whose every page is admitted, before its Set Date searches
     * and closing reads. */
    closing(ledger: Alln1Ledger): Cursor {
      return schema.parse({
        source: tenant.source,
        phase: "closing",
        ...ledger,
        progressHash: progressHash(ledger, null),
      });
    },
  };
}
export const Alln1Cursor = createAlln1Cursor(ALLN1_TENANT);
export const Alln1CursorSchema = Alln1Cursor.schema;
export type Alln1Cursor = z.infer<typeof Alln1CursorSchema>;

export const GrandpajohnsCursor = createAlln1Cursor(GRANDPAJOHNS_TENANT);
