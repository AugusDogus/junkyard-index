import { z } from "zod";
import { pickapartvaSnapshotHash } from "./pickapartva-snapshot";
import {
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_MAX_TIE_SEARCHES,
  PICKAPARTVA_PAGE_SIZE,
  PICKAPARTVA_YARD_CODES,
  pickapartvaPageUrl,
  pickapartvaSearchHref,
  pickapartvaSearchScopes,
} from "./pickapartva-yard-metadata";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z
  .number()
  .int()
  .nonnegative()
  .max(PICKAPARTVA_MAX_PAGES * PICKAPARTVA_PAGE_SIZE);
export const PickapartvaCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("pickapartva"), phase: z.literal("start") })
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
        // to one per yard for each date. Checkpoints written before these
        // searches carry none.
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
          .max(PICKAPARTVA_MAX_TIE_SEARCHES * PICKAPARTVA_YARD_CODES.length)
          .default([]),
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
      // Each repeated date has one unfiltered search or one search per yard.
      JSON.stringify(cursor.searches.map((search) => search.url)) !==
        JSON.stringify(
          [...new Set(cursor.searches.map((search) => search.date))].flatMap(
            (date) =>
              pickapartvaSearchScopes(
                cursor.searches.filter((search) => search.date === date).length,
              ).map((id) => pickapartvaSearchHref(date, id)),
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
