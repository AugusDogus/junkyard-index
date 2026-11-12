import { z } from "zod";
import { pickapartvaHash } from "./pickapartva-parser";
import {
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_PAGE_SIZE,
  pickapartvaPageUrl,
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
        pickapartvaHash(
          cursor.receipts.map((receipt) => [
            receipt.page,
            receipt.url,
            receipt.hash,
          ]),
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
