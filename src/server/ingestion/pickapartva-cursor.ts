import { z } from "zod";
import { pickapartvaHash } from "./pickapartva-parser";
import { pickapartvaSnapshotHash } from "./pickapartva-snapshot";
import {
  PICKAPARTVA_MAKE,
  PICKAPARTVA_MAX_MAKES,
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_MAX_TIE_SEARCHES,
  PICKAPARTVA_PAGE_SIZE,
  PICKAPARTVA_YARD_CODES,
  pickapartvaPageUrl,
  pickapartvaSearchHref,
  pickapartvaSearchPlan,
  pickapartvaSearchTarget,
  pickapartvaSetDate,
} from "./pickapartva-yard-metadata";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z
  .number()
  .int()
  .nonnegative()
  .max(PICKAPARTVA_MAX_PAGES * PICKAPARTVA_PAGE_SIZE);
const field = z.string().max(200);
const make = z.string().max(40).regex(PICKAPARTVA_MAKE);
// Fields in the parser's order, so a parsed record hashes as it was read.
const record = z
  .object({
    cardId: field.nullable(),
    stock: field,
    year: field,
    make: field,
    model: field,
    vin: field,
    yardCode: z.enum(PICKAPARTVA_YARD_CODES),
    row: field,
    setDate: field,
    imageUrl: z.string().max(1000).nullable(),
  })
  .strict();
/**
 * One yard's set-date search that reached the 500-card cap, split into one
 * search per native make. `makes` is the native make selector in order and
 * `searches` holds the completed make searches, in that order, with their
 * donors, so a later chunk can rebuild the census without repeating them.
 * `startedAt` is the epoch milliseconds at which the capped yard search was
 * read, which bounds how long the saved make searches are trusted.
 */
const partition = z
  .object({
    date: z.string().max(10),
    id: z.enum(PICKAPARTVA_YARD_CODES),
    makes: z.array(make).min(1).max(PICKAPARTVA_MAX_MAKES),
    startedAt: z.number().int().positive(),
    searches: z
      .array(
        z
          .object({
            make,
            url: z.string().max(1000),
            hash,
            records: z.array(record).max(PICKAPARTVA_PAGE_SIZE - 1),
          })
          .strict(),
      )
      .max(PICKAPARTVA_MAX_MAKES),
  })
  .strict()
  .superRefine((split, context) => {
    if (
      !pickapartvaSetDate(split.date) ||
      new Set(split.makes).size !== split.makes.length ||
      split.searches.length > split.makes.length ||
      split.searches.some(
        (search, index) =>
          search.make !== split.makes[index] ||
          search.url !==
            pickapartvaSearchHref(split.date, split.id, search.make) ||
          search.hash !== pickapartvaHash([split.date, search.records]) ||
          search.records.some(
            (donor) =>
              donor.setDate !== split.date ||
              donor.yardCode !== split.id ||
              donor.make !== search.make,
          ),
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pick-A-Part VA make split checkpoint does not match its Set Date, yard, makes or donors",
      });
  });
export type PickapartvaMakeSplit = z.infer<typeof partition>;
const partitions = z
  .array(partition)
  .max(PICKAPARTVA_MAX_TIE_SEARCHES * PICKAPARTVA_YARD_CODES.length)
  .refine(
    (splits) =>
      new Set(splits.map((split) => `${split.date}:${split.id}`)).size ===
      splits.length,
    "Pick-A-Part VA make split checkpoint repeats a Set Date and yard",
  );
export const pickapartvaMakeSplitComplete = (split: PickapartvaMakeSplit) =>
  split.searches.length === split.makes.length;

export const PickapartvaCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("pickapartva"), phase: z.literal("start") })
      .strict(),
    // A yard's set-date search reached the cap, so its make searches run
    // across chunks before the census is read again. Once every split is
    // complete, the next chunk reads the census with them.
    z
      .object({
        source: z.literal("pickapartva"),
        phase: z.literal("makes"),
        partitions: partitions.refine(
          (splits) => splits.length > 0,
          "Pick-A-Part VA make split checkpoint has no split",
        ),
      })
      .strict(),
    z
      .object({
        source: z.literal("pickapartva"),
        phase: z.literal("pages"),
        snapshotHash: hash,
        lastPage: z.number().int().min(2).max(PICKAPARTVA_MAX_PAGES),
        nextPage: z.number().int().min(2).max(PICKAPARTVA_MAX_PAGES),
        receipts: z
          .array(
            z
              .object({
                page: z.number().int().positive().max(PICKAPARTVA_MAX_PAGES),
                url: z.string().max(1000),
                hash,
              })
              .strict(),
          )
          .min(2)
          .max(PICKAPARTVA_MAX_PAGES),
        // Set-date searches that recovered donors hidden by catalog ties, up
        // to one per yard, or one per make in a split yard, for each date.
        // Checkpoints written before these searches carry none.
        searches: z
          .array(
            z
              .object({
                date: z.string().max(10),
                url: z.string().max(1000),
                hash,
              })
              .strict(),
          )
          .max(
            PICKAPARTVA_MAX_TIE_SEARCHES *
              PICKAPARTVA_YARD_CODES.length *
              PICKAPARTVA_MAX_MAKES,
          )
          .default([]),
        // The complete make splits those searches used, so a resumed chunk
        // rebuilds the same census.
        partitions: partitions.default([]),
        processed: count,
        emitted: count,
        rejected: count,
        duplicates: count,
      })
      .strict(),
    z
      .object({
        source: z.literal("pickapartva"),
        phase: z.literal("complete"),
      })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "pages") return;
    if (
      cursor.snapshotHash !==
        pickapartvaSnapshotHash(cursor.receipts, cursor.searches) ||
      // Each repeated date has one unfiltered search, or for each yard one
      // search or one search per make.
      !pickapartvaSearchPlan(cursor.searches.map((search) => search.url)) ||
      cursor.searches.some(
        (search) => pickapartvaSearchTarget(search.url)?.date !== search.date,
      ) ||
      !cursor.partitions.every(pickapartvaMakeSplitComplete) ||
      JSON.stringify(
        cursor.searches
          .filter(
            (search) => pickapartvaSearchTarget(search.url)?.make !== "ANY",
          )
          .map((search) => [search.date, search.url, search.hash]),
      ) !==
        JSON.stringify(
          cursor.partitions.flatMap((split) =>
            split.searches.map((search) => [
              split.date,
              search.url,
              search.hash,
            ]),
          ),
        ) ||
      cursor.nextPage > cursor.lastPage ||
      cursor.receipts.length !== cursor.lastPage ||
      cursor.processed !== (cursor.nextPage - 1) * PICKAPARTVA_PAGE_SIZE ||
      cursor.processed !==
        cursor.emitted + cursor.rejected + cursor.duplicates ||
      new Set(cursor.receipts.map((receipt) => receipt.hash)).size !==
        cursor.receipts.length ||
      cursor.receipts.some(
        (receipt, index) =>
          receipt.page !== index + 1 ||
          pickapartvaPageUrl(receipt.url, index + 1) !== receipt.url,
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pick-A-Part VA cursor page coverage, source scope or cumulative accounting is inconsistent",
      });
  });
export type PickapartvaCursor = z.infer<typeof PickapartvaCursorSchema>;
export const PickapartvaCursor = {
  initial: { source: "pickapartva", phase: "start" },
} as const satisfies { initial: PickapartvaCursor };
