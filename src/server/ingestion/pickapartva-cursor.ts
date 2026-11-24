import { z } from "zod";
import { pickapartvaCardKey } from "./pickapartva-parser";
import { PICKAPARTVA_MAX_REPLANS } from "./pickapartva-recovery";
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
  pickapartvaSetDate,
} from "./pickapartva-yard-metadata";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_CARDS = PICKAPARTVA_MAX_PAGES * PICKAPARTVA_PAGE_SIZE;
const count = z.number().int().nonnegative().max(MAX_CARDS);
const field = z.string().max(200);
const scope = z.enum(["ANY", ...PICKAPARTVA_YARD_CODES]);
const make = z.union([
  z.literal("ANY"),
  z.string().max(40).regex(PICKAPARTVA_MAKE),
]);
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
/** Every yard, both yards and one search per native make of each yard. */
const MAX_SEARCHES =
  1 + PICKAPARTVA_YARD_CODES.length * (1 + PICKAPARTVA_MAX_MAKES);
const step = z.object({ id: scope, make }).strict();
const stepKey = (entry: { id: string; make: string }) =>
  `${entry.id}:${entry.make}`;

/** Whether the searches and pending steps follow `PickapartvaRecovery`'s
 * escalation: every yard first unless the date fills a search page, a yard
 * only after that search was capped or skipped, a make only of a capped yard
 * search, and a capped make search only as the one that resolved the date. */
function escalates(entry: {
  slots: number;
  shown: string[];
  searches: Array<{ id: string; make: string; capped: boolean }>;
  pending: Array<{ id: string; make: string }>;
}) {
  const steps = [...entry.searches, ...entry.pending];
  const capped = (id: string) =>
    entry.searches.some(
      (search) => search.id === id && search.make === "ANY" && search.capped,
    );
  const everyYard = entry.shown.length + entry.slots < PICKAPARTVA_PAGE_SIZE;
  return (
    (steps[0]?.id === "ANY") === everyYard &&
    steps.every((step, index) =>
      step.id === "ANY"
        ? index === 0
        : step.make === "ANY"
          ? !everyYard || capped("ANY")
          : capped(step.id),
    ) &&
    entry.searches.every(
      (search) =>
        search.make === "ANY" || !search.capped || entry.pending.length === 0,
    )
  );
}

/** See `PickapartvaRecovery`. */
const recovery = z
  .object({
    date: z.string().max(10),
    slots: z.number().int().positive().max(MAX_CARDS),
    shown: z.array(z.string().max(500)).max(MAX_CARDS),
    startedAt: z.number().int().positive(),
    searches: z
      .array(
        step
          .extend({ url: z.string().max(1000), hash, capped: z.boolean() })
          .strict(),
      )
      .max(MAX_SEARCHES),
    hidden: z.array(step.extend({ record }).strict()).max(MAX_CARDS),
    pending: z.array(step).max(MAX_SEARCHES),
  })
  .strict()
  .superRefine((entry, context) => {
    const shown = new Set(entry.shown);
    const hidden = entry.hidden.map((donor) =>
      pickapartvaCardKey(donor.record),
    );
    const searched = entry.searches.map(stepKey);
    const pending = entry.pending.map(stepKey);
    if (
      !pickapartvaSetDate(entry.date) ||
      shown.size !== entry.shown.length ||
      JSON.stringify(entry.shown) !== JSON.stringify([...entry.shown].sort()) ||
      new Set([...searched, ...pending]).size !==
        searched.length + pending.length ||
      [...entry.searches, ...entry.pending].some(
        (search) =>
          (search.make !== "ANY" && search.id === "ANY") ||
          pickapartvaSearchHref(entry.date, search.id, search.make) === null,
      ) ||
      entry.searches.some(
        (search) =>
          search.url !==
          pickapartvaSearchHref(entry.date, search.id, search.make),
      ) ||
      new Set(hidden).size !== hidden.length ||
      hidden.some((key) => shown.has(key)) ||
      entry.hidden.some(
        (donor) =>
          donor.record.setDate !== entry.date ||
          !searched.includes(stepKey(donor)) ||
          (donor.id !== "ANY" && donor.record.yardCode !== donor.id) ||
          (donor.make !== "ANY" && donor.record.make !== donor.make),
      ) ||
      hidden.length > entry.slots ||
      (entry.pending.length === 0) !== (hidden.length === entry.slots) ||
      !escalates(entry)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pick-A-Part VA set-date recovery checkpoint does not match its Set Date, searches or hidden donors",
      });
  });
const recoveries = z
  .array(recovery)
  .max(PICKAPARTVA_MAX_TIE_SEARCHES)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.date)).size === entries.length,
    "Pick-A-Part VA set-date recovery checkpoint repeats a Set Date",
  );

export const PickapartvaCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("pickapartva"), phase: z.literal("start") })
      .strict(),
    // A catalog read found Set Date ties whose hidden donors are not yet
    // recovered. The searches run in their own chunks, then the next chunk
    // reads the catalog again with the recoveries.
    z
      .object({
        source: z.literal("pickapartva"),
        phase: z.literal("searches"),
        // Censuses since the searches began that planned a date's searches
        // again. It never resets, so it bounds the attempt's re-plans.
        replans: z.number().int().min(0).max(PICKAPARTVA_MAX_REPLANS),
        recoveries: recoveries.refine(
          (entries) => entries.length > 0,
          "Pick-A-Part VA set-date recovery checkpoint has no Set Date",
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
        // Every search of the recoveries, in order, for the fingerprint.
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
          .max(PICKAPARTVA_MAX_TIE_SEARCHES * MAX_SEARCHES),
        // The resolved recoveries the census used, so a resumed chunk
        // rebuilds the same census.
        recoveries,
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
      cursor.recoveries.some((entry) => entry.pending.length > 0) ||
      JSON.stringify(cursor.searches) !==
        JSON.stringify(
          cursor.recoveries.flatMap((entry) =>
            entry.searches.map((search) => ({
              date: entry.date,
              url: search.url,
              hash: search.hash,
            })),
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
