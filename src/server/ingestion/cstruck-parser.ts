import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import { heavyTruckPartsParser } from "./heavytruckparts-parser";
import {
  heavyTruckPartsAnchors,
  heavyTruckPartsDivs,
  heavyTruckPartsDocument,
  heavyTruckPartsText,
} from "./heavytruckparts-html";
import {
  CSTRUCK_CATALOG,
  cstruckRangeUrl,
  type CstruckRange,
} from "./cstruck-yard-metadata";

const parser = heavyTruckPartsParser({
  attributes: "vehicle-specs",
  supplier: "7131988",
  itemCategory: "Vehicle-For-Sale",
  title: "Vehicle For Sale",
  // The native card double-escapes the ampersand. Do not relax owner matching.
  location: "Sold by: C&amp;S Truck Sales Location: Pukwana SD",
});
export const CstruckRecordSchema = parser.recordSchema;
export type CstruckRecord = z.infer<typeof CstruckRecordSchema>;
export const CstruckPageSchema = z
  .object({
    range: z.tuple([
      z.number().int().min(1970).max(2027),
      z.number().int().min(1970).max(2027),
    ]),
    capped: z.boolean(),
    hasMore: z.boolean(),
    records: z.array(CstruckRecordSchema).max(25),
  })
  .strict();
export type CstruckPage = z.infer<typeof CstruckPageSchema>;
export function parseCstruckStore(raw: string): number {
  const html = heavyTruckPartsDocument(raw),
    text = heavyTruckPartsText(html);
  if (
    ![
      "C&S Truck Sales",
      "605-894-4100",
      "24988 350th Ave",
      "Pukwana, SD 57370 USA",
    ].every((s) => text.includes(s))
  )
    throw new Error("C&S store owner, published address or phone changed");
  const links = heavyTruckPartsAnchors(html).filter(
    (a) => a.href === CSTRUCK_CATALOG,
  );
  const total = Number(
    /^Complete Vehicle - (\d+)$/.exec(links[0]?.text ?? "")?.[1],
  );
  if (
    links.length !== 1 ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > 375
  )
    throw new Error("C&S store lacks a unique bounded Complete Vehicle count");
  return total;
}
export function parseCstruckPage(
  raw: string,
  range: CstruckRange,
): CstruckPage {
  const html = heavyTruckPartsDocument(raw),
    regions = heavyTruckPartsDivs(html, "search_result_div"),
    region = regions[0];
  if (regions.length !== 1 || region === undefined)
    throw new Error("C&S inventory region is missing or repeated");
  const records = parser.cards(region);
  const next = new Set(
    heavyTruckPartsAnchors(region)
      .filter((a) => a.text === "Next")
      .map((a) => a.href),
  );
  if (
    next.size > 1 ||
    (next.size === 1 && !next.has(cstruckRangeUrl(range) + "&page=2"))
  )
    throw new Error(
      "C&S pagination changed supplier, range or next-page control",
    );
  if (
    records.length > 25 ||
    (next.size && records.length !== 25) ||
    new Set(records.map((r) => r.id)).size !== records.length ||
    records.some(
      (r) =>
        Number(r.year) < range[0] ||
        Number(r.year) > range[1] ||
        (r.description !== "CAB & CHASSIS" &&
          !(r.make === "TRAILER" && r.description === "FLATBED")),
    )
  )
    throw new Error(
      "C&S native range, donor description or item uniqueness changed",
    );
  if (!records.length) {
    const emptyControls = [
      ...region.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
    ]
      .filter((m) => inventoryHtmlAttribute(m[1] ?? "", "class") === "bigtitle")
      .map((m) => heavyTruckPartsText(m[2] ?? ""));
    if (
      emptyControls.length !== 1 ||
      emptyControls[0] !== "Sorry, no matches were found for: ."
    )
      throw new Error(
        "C&S empty inventory lacks the native no-matches control",
      );
  }
  // Even exactly 25 without Next is ambiguous. Split rather than assume complete.
  return CstruckPageSchema.parse({
    range: [...range],
    records,
    capped: records.length === 25,
    hasMore: next.size === 1,
  });
}
