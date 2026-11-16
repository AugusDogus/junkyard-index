import { stripInventoryRawText } from "./inventory-html";
import { parseIdipullInventory, type IdipullRecord } from "./idipull-parser";
import { vinplusCalendarDate } from "./vinplus-protocol";

export type IdipullCatalog = {
  updated: string;
  records: IdipullRecord[];
};

// Qualification confirms MM/DD/YY arrival dates in this century. Preserve a
// calendar date only, with no invented time of day or UTC offset.
function date(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(raw);
  return match
    ? vinplusCalendarDate(
        2000 + Number(match[3]),
        Number(match[1]),
        Number(match[2]),
      )
    : null;
}

export const IdipullCatalog = {
  date,
  parse(raw: string): IdipullCatalog {
    const records = parseIdipullInventory(raw);
    const stamps = [
      ...stripInventoryRawText(raw).matchAll(
        /\bUpdated:\s*(\d{2}\/\d{2}\/\d{2})\b/g,
      ),
    ];
    const updated = date(stamps[0]?.[1] ?? "");
    if (stamps.length !== 1 || updated === null)
      throw new Error(
        "Idaho Falls inventory update label is missing, ambiguous or invalid",
      );
    return { updated, records };
  },
  signature(catalog: IdipullCatalog): string {
    // Compare every native field and multiplicity, independent of table order.
    return JSON.stringify({
      updated: catalog.updated,
      records: catalog.records.map((record) => JSON.stringify(record)).sort(),
    });
  },
  validateCurrency(
    catalog: IdipullCatalog,
    arrivals: Iterable<string | null>,
    asOf: Date,
  ): void {
    if (!Number.isFinite(asOf.getTime()))
      throw new Error(
        "Idaho Falls currency check requires a valid observation date",
      );
    const today = asOf.toISOString().slice(0, 10);
    const cutoff = new Date(Date.parse(today) - 60 * 86400000)
      .toISOString()
      .slice(0, 10);
    if (
      catalog.updated > today ||
      ![...arrivals].some(
        (arrival) =>
          arrival !== null &&
          arrival <= catalog.updated &&
          arrival <= today &&
          arrival >= cutoff,
      )
    )
      throw new Error(
        "Idaho Falls has no admitted arrival within the last 60 days, or its update label is future-dated; verify inventory currency before retrying",
      );
  },
} as const;
