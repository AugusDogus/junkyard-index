import type {
  HtpPage,
  HtpYearFill,
  HtpYearPage,
} from "./heavytruckparts-census";
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
  htpYearUrl,
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
function nativeRecords(
  raw: string,
  s: HtpSupplier,
  page: number,
  total: number,
  url: (page: number) => string,
) {
  const html = heavyTruckPartsDocument(raw),
    regions = heavyTruckPartsDivs(html, "search_result_div"),
    region = regions[0],
    last = Math.ceil(total / 25);
  if (regions.length !== 1 || !region || page > last)
    throw new Error(`HTP ${s.code} inventory region or page changed`);
  for (const [label, expected] of [
    ["Next", page < last ? url(page + 1) : null],
    ["Last", page < last ? url(last) : null],
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
  return records;
}
export function parseHtpCatalog(
  raw: string,
  s: HtpSupplier,
  direction: "DESC" | "ASC",
  page: number,
  total: number,
): HtpPage {
  return {
    direction,
    page,
    records: nativeRecords(raw, s, page, total, (p) =>
      htpCatalogUrl(s, direction, p),
    ),
  };
}
/** Page 1 of a single-year query; the dual-sort year count bounds its size. */
export function parseHtpYearFill(
  raw: string,
  s: HtpSupplier,
  fill: HtpYearFill,
): HtpYearPage {
  return {
    year: fill.year,
    direction: fill.direction,
    records: nativeRecords(raw, s, 1, fill.count, (p) =>
      htpYearUrl(s, fill.year, fill.direction, p),
    ),
  };
}
