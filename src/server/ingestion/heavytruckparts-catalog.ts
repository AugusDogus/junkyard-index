import type { HtpPage } from "./heavytruckparts-census";
import { heavyTruckPartsParser } from "./heavytruckparts-parser";
import {
  heavyTruckPartsAnchors,
  heavyTruckPartsDivs,
  heavyTruckPartsDocument,
  heavyTruckPartsText,
} from "./heavytruckparts-html";
import {
  HTP_ORIGIN,
  htpCatalogUrl,
  type HtpSupplier,
} from "./heavytruckparts-yard-metadata";

export function htpRecordParser(s: HtpSupplier) {
  return heavyTruckPartsParser({ ...s, attributes: "marketplace" });
}
export function parseHtpStore(raw: string, s: HtpSupplier): number {
  const html = heavyTruckPartsDocument(raw),
    text = heavyTruckPartsText(html);
  if (!s.storeClaims.every((claim) => text.includes(claim)))
    throw new Error(`HTP ${s.code} store identity or physical address changed`);
  const links = heavyTruckPartsAnchors(html).filter(
    (a) =>
      a.href ===
      `${HTP_ORIGIN}/search/Any/Any/Complete-Vehicle?fltpc=${s.supplier}&store=${s.store}`,
  );
  const total = Number(
    /^Complete Vehicle - (\d+)$/.exec(links[0]?.text ?? "")?.[1],
  );
  if (
    links.length !== 1 ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > 2000
  )
    throw new Error(`HTP ${s.code} lacks a unique bounded store count`);
  return total;
}
export function parseHtpCatalog(
  raw: string,
  s: HtpSupplier,
  direction: "DESC" | "ASC",
  page: number,
  total: number,
): HtpPage {
  const html = heavyTruckPartsDocument(raw),
    regions = heavyTruckPartsDivs(html, "search_result_div"),
    region = regions[0],
    last = Math.ceil(total / 25);
  if (regions.length !== 1 || !region || page > last)
    throw new Error(`HTP ${s.code} inventory region or page changed`);
  for (const [label, expected] of [
    ["Next", page < last ? htpCatalogUrl(s, direction, page + 1) : null],
    ["Last", page < last ? htpCatalogUrl(s, direction, last) : null],
  ] as const) {
    const links = new Set(
      heavyTruckPartsAnchors(region)
        .filter((a) => a.text === label)
        .map((a) => a.href),
    );
    if (
      expected === null
        ? links.size !== 0
        : links.size !== 1 || !links.has(expected)
    )
      throw new Error(
        `HTP ${s.code} ${label} pagination disagrees with store count`,
      );
  }
  const records = htpRecordParser(s).cards(region);
  if (
    records.length !== Math.min(25, total - (page - 1) * 25) ||
    new Set(records.map((r) => r.id)).size !== records.length
  )
    throw new Error(`HTP ${s.code} page size or item uniqueness changed`);
  return { direction, page, records };
}
