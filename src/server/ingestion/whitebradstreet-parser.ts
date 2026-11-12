import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { inventoryVin } from "./inventory-vin";
import {
  parseTruckPartsCatalogPage,
  type TruckPartsCatalogRecord,
} from "./truck-parts-catalog";
import {
  WHITEBRADSTREET_CATALOG,
  WHITEBRADSTREET_YARD,
} from "./whitebradstreet-yard-metadata";

const text = (raw: string) =>
  raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
const comparable = (raw: string) => text(raw).toUpperCase();

function ownership(raw: string): string {
  if (Buffer.byteLength(raw) > 4_000_000 || !/<\/html\s*>\s*$/i.test(raw))
    throw new Error(
      "White & Bradstreet native document is oversized or truncated",
    );
  const html = stripInventoryRawText(raw);
  const anchors = [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)];
  const address = anchors.some(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "href") ===
        "https://maps.app.goo.gl/Ufxo1ycqWZjpHmtX8" &&
      text(match[2] ?? "").includes(
        "1020 Weeks Mills Rd, Augusta, ME 04330, United States",
      ),
  );
  const phone = anchors.some(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "href")?.replace(/[\s-]/g, "") ===
      "tel:" + WHITEBRADSTREET_YARD.phone.replace(/-/g, ""),
  );
  if (!address || !phone)
    throw new Error(
      "White & Bradstreet physical yard address, native map link or phone changed; verify ownership before retrying",
    );
  return html;
}

export function parseWhitebradstreetPage(raw: string, page: number) {
  ownership(raw);
  return parseTruckPartsCatalogPage(raw, page, WHITEBRADSTREET_CATALOG);
}

/** A source-linked native detail verifies the active Salvage listing scope. */
export function parseWhitebradstreetControl(
  raw: string,
  record: TruckPartsCatalogRecord,
): void {
  const html = ownership(raw);
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (
    headings.length !== 1 ||
    !/^Lot #.* - Now Wrecking$/.test(text(headings[0]?.[1] ?? ""))
  )
    throw new Error(
      "White & Bradstreet native detail no longer confirms Now Wrecking",
    );
  const fields = new Map<string, string>();
  for (const pair of html.matchAll(
    /<div\b[^>]*class=['"][^'"]*\bdetail-title\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=['"][^'"]*\bdetail-description\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const label = text(pair[1] ?? "");
    if (fields.has(label))
      throw new Error(
        "White & Bradstreet native detail repeats field " + label,
      );
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
      fields.has("Lot Number") &&
      fields.get("Lot Number") !== record.stockNumber)
  )
    throw new Error(
      "White & Bradstreet listing and active detail disagree on native VIN, YMM or provided stock",
    );
}
