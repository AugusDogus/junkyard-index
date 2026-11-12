import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import {
  MICHIGANTRUCK_MAX_PAGES,
  MICHIGANTRUCK_PAGE_SIZE,
  michigantruckPageUrl,
} from "./michigantruck-parser";
import { MICHIGANTRUCK_CATALOG } from "./michigantruck-yard-metadata";

const count = z
  .number()
  .int()
  .min(0)
  .max(MICHIGANTRUCK_MAX_PAGES * MICHIGANTRUCK_PAGE_SIZE);
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
  z
    .object({
      id,
      status: z.literal("excluded"),
      vin: z.null(),
      identity: z.null(),
    })
    .strict(),
]);
export type MichigantruckSeen = z.infer<typeof seen>;
export const MichigantruckCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("michigantruck"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        source: z.literal("michigantruck"),
        phase: z.literal("pages"),
        total: count.positive(),
        salvageTotal: count.positive(),
        retailTotal: count,
        nextUrl: z.string().max(1000),
        processed: count,
        emitted: count,
        excluded: count,
        rejected: count,
        duplicates: count,
        seen: z.array(seen).min(25).max(175),
        pages: z
          .array(z.object({ url: z.string().max(1000), hash }).strict())
          .min(1)
          .max(MICHIGANTRUCK_MAX_PAGES - 1),
      })
      .strict(),
    z
      .object({
        source: z.literal("michigantruck"),
        phase: z.literal("complete"),
      })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "pages") return;
    const accepted = new Map<string, string>();
    const identities = new Set<string>();
    let valid = true;
    for (const row of cursor.seen) {
      if (row.status === "duplicate") {
        if (accepted.get(row.vin) !== row.identity) valid = false;
      } else if (row.vin !== null) {
        if (identities.has(row.vin)) valid = false;
        identities.add(row.vin);
        if (row.status === "available") accepted.set(row.vin, row.identity);
      }
    }
    if (
      cursor.total !== cursor.salvageTotal + cursor.retailTotal ||
      cursor.processed !== cursor.pages.length * 25 ||
      cursor.processed >= cursor.total ||
      cursor.seen.length !== cursor.processed ||
      cursor.emitted !==
        cursor.seen.filter((row) => row.status === "available").length ||
      cursor.excluded !==
        cursor.seen.filter((row) => row.status === "excluded").length ||
      cursor.rejected !==
        cursor.seen.filter((row) => row.status === "incomplete").length ||
      cursor.duplicates !==
        cursor.seen.filter((row) => row.status === "duplicate").length ||
      cursor.processed !==
        cursor.emitted +
          cursor.excluded +
          cursor.rejected +
          cursor.duplicates ||
      cursor.excluded > cursor.retailTotal ||
      cursor.processed - cursor.excluded > cursor.salvageTotal ||
      new Set(cursor.seen.map((row) => row.id)).size !== cursor.seen.length ||
      new Set(cursor.pages.map((page) => page.hash)).size !==
        cursor.pages.length ||
      cursor.pages[0]?.url !== MICHIGANTRUCK_CATALOG ||
      cursor.pages.some(
        (page, index) => !michigantruckPageUrl(page.url, index + 1),
      ) ||
      !michigantruckPageUrl(cursor.nextUrl, cursor.pages.length + 1) ||
      !valid
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Michigan Truck checkpoint scope, prefix identities or cumulative accounting is inconsistent; retain the last validated checkpoint",
      });
  });
export type MichigantruckCursor = z.infer<typeof MichigantruckCursorSchema>;
export const MichigantruckCursor = {
  initial: { source: "michigantruck", phase: "start" },
} as const satisfies { initial: MichigantruckCursor };
