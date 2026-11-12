import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { inventoryVin } from "./inventory-vin";
import {
  RIVERVALLEY_CATALOG,
  RIVERVALLEY_YARD,
} from "./rivervalley-yard-metadata";
import {
  parseTruckPartsCatalogPage,
  type TruckPartsCatalogRecord,
} from "./truck-parts-catalog";

const text = (raw: string) =>
  raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
const comparable = (raw: string) => text(raw).toUpperCase();

function ownership(raw: string): string {
  if (!/<\/html\s*>\s*$/i.test(raw))
    throw new Error("River Valley HTML document is truncated");
  const html = stripInventoryRawText(raw);
  const body = text(html);
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(([tag]) => {
    const href = inventoryHtmlAttribute(tag, "href")?.trim();
    return (
      href?.startsWith("tel:") &&
      href.slice(4).replace(/\D/g, "") ===
        RIVERVALLEY_YARD.phone.replace(/\D/g, "")
    );
  });
  if (!body.includes("288 W South Tec Drive, Kankakee, IL 60901") || !phone)
    throw new Error(
      "River Valley physical yard address or phone changed; verify ownership before retrying",
    );
  return html;
}

export function parseRivervalleyPage(raw: string, page: number) {
  ownership(raw);
  return parseTruckPartsCatalogPage(raw, page, RIVERVALLEY_CATALOG);
}

/** One source-linked native detail proves the Salvage catalog's active scope. */
export function parseRivervalleyControl(
  raw: string,
  record: TruckPartsCatalogRecord,
): void {
  const html = ownership(raw);
  const titles = [
    ...html.matchAll(
      /<div\b[^>]*class=['"][^'"]*\bdesc-title\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi,
    ),
  ];
  const headings = [
    ...(titles[0]?.[1] ?? "").matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
  ];
  if (
    titles.length !== 1 ||
    headings.length !== 1 ||
    !/^Lot #.* - Now Wrecking$/.test(text(headings[0]?.[1] ?? ""))
  )
    throw new Error(
      "River Valley native detail no longer confirms Now Wrecking",
    );
  const fields = new Map<string, string>();
  for (const pair of html.matchAll(
    /<div\b[^>]*class=['"][^'"]*\bdetail-title\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=['"][^'"]*\bdetail-description\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const label = text(pair[1] ?? "");
    if (fields.has(label))
      throw new Error("River Valley native detail repeats field " + label);
    fields.set(label, text(pair[2] ?? ""));
  }
  const vin = inventoryVin(fields.get("VIN") ?? "", fields.get("Year") ?? "");
  if (
    !vin ||
    vin !== inventoryVin(record.vin, record.year) ||
    fields.get("Year") !== record.year ||
    comparable(fields.get("Make") ?? "") !== comparable(record.make) ||
    comparable(fields.get("Model") ?? "") !== comparable(record.model) ||
    (record.stockNumber !== null &&
      fields.get("Lot Number") &&
      fields.get("Lot Number") !== record.stockNumber)
  )
    throw new Error(
      "River Valley listing and active detail disagree on native VIN, YMM or provided stock",
    );
}
