import { z } from "zod";
import {
  heavyTruckPartsParser,
  type HeavyTruckPartsRecord,
} from "./heavytruckparts-parser";
import {
  dutchersAnchors,
  dutchersDivs,
  dutchersDocument,
} from "./dutchers-html";
import {
  DUTCHERS_MAX_PAGES,
  DUTCHERS_PAGE_SIZE,
  dutchersCatalogUrl,
  type DutchersDirection,
} from "./dutchers-yard-metadata";

const parser = heavyTruckPartsParser({
  attributes: "vin-only",
  supplier: "3987345",
  itemCategory: "Complete-Vehicle",
  title: "Complete Vehicle",
  location: "Sold by: Dutchers Inc Heavy Truck Div NY Location: MORRISVILLE NY",
});
export const dutchersItemId = parser.itemId;
export const DutchersRecordSchema = parser.recordSchema;
export type DutchersRecord = HeavyTruckPartsRecord;
export const DutchersPageSchema = z
  .object({
    direction: z.enum(["DESC", "ASC"]),
    page: z.number().int().min(1).max(DUTCHERS_MAX_PAGES),
    records: z.array(DutchersRecordSchema).min(1).max(DUTCHERS_PAGE_SIZE),
  })
  .strict();
export type DutchersPage = z.infer<typeof DutchersPageSchema>;

export function parseDutchersCatalog(
  raw: string,
  direction: DutchersDirection,
  page: number,
  total: number,
): DutchersPage {
  const html = dutchersDocument(raw),
    last = Math.ceil(total / DUTCHERS_PAGE_SIZE);
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    last > DUTCHERS_MAX_PAGES ||
    page < 1 ||
    page > last
  )
    throw new Error(
      "Dutcher catalog page or store total is outside the native bound",
    );
  const regions = dutchersDivs(html, "search_result_div"),
    region = regions[0];
  if (regions.length !== 1 || region === undefined)
    throw new Error("Dutcher native inventory region is absent or repeated");
  const links = dutchersAnchors(region);
  for (const [label, expected] of [
    ["Next", page < last ? dutchersCatalogUrl(direction, page + 1) : null],
    ["Last", page < last ? dutchersCatalogUrl(direction, last) : null],
  ] as const) {
    const urls = new Set(
      links.filter((a) => a.text === label).map((a) => a.href),
    );
    if (
      expected === null
        ? urls.size !== 0
        : urls.size !== 1 || !urls.has(expected)
    )
      throw new Error(
        "Dutcher published " +
          label +
          " pagination differs from the store total or selected year order",
      );
  }
  const records = parser.cards(region);
  if (
    records.length !==
      Math.min(DUTCHERS_PAGE_SIZE, total - (page - 1) * DUTCHERS_PAGE_SIZE) ||
    new Set(records.map((r) => r.id)).size !== records.length
  )
    throw new Error(
      "Dutcher native page size or within-page item uniqueness does not reconcile",
    );
  return DutchersPageSchema.parse({ direction, page, records });
}
