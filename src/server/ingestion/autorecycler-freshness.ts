import {
  buildInventoryMsearchBody,
  postAutorecyclerElasticsearchMsearch,
} from "./autorecycler-client";
import {
  AutorecyclerInventoryPage,
  AUTORECYCLER_PAGE_SIZE,
} from "./autorecycler-inventory-page";
import { inventoryVin } from "./inventory-vin";
import { parseAutorecyclerNameText } from "./autorecycler-transform";

export const AUTORECYCLER_FRESHNESS_MS = 60 * 24 * 60 * 60 * 1_000;
export type { AutorecyclerFreshness } from "./autorecycler-freshness-state";
import type { AutorecyclerFreshness } from "./autorecycler-freshness-state";

export function isFreshAutorecyclerDate(date: number, asOf: number): boolean {
  return (
    Number.isFinite(date) &&
    date <= asOf &&
    date >= asOf - AUTORECYCLER_FRESHNESS_MS
  );
}

/** Compare additions, never modification/sync dates. A future date cannot
 * revive a yard or prevent an older, genuinely recent addition from doing so. */
export function selectAutorecyclerFeed(
  arioDates: Iterable<number>,
  legacyNewest: number | null,
  asOf: number,
): "ario" | "legacy" | "stale" {
  let newest = -Infinity;
  for (const date of arioDates)
    if (isFreshAutorecyclerDate(date, asOf)) newest = Math.max(newest, date);
  const legacy =
    legacyNewest !== null && isFreshAutorecyclerDate(legacyNewest, asOf)
      ? legacyNewest
      : -Infinity;
  return newest === -Infinity && legacy === -Infinity
    ? "stale"
    : newest >= legacy
      ? "ario"
      : "legacy";
}

export async function discoverFreshAutorecyclerYards(
  asOf: number,
  fetchPage: (
    body: ReturnType<typeof buildInventoryMsearchBody>,
  ) => Promise<unknown> = postAutorecyclerElasticsearchMsearch,
): Promise<AutorecyclerFreshness> {
  const legacy: Record<string, number> = {};
  let before: string | null = null;
  for (let pages = 0; pages < 1_000; pages++) {
    const body = buildInventoryMsearchBody(before, AUTORECYCLER_PAGE_SIZE);
    const search = body.searches[0];
    if (!search || !Array.isArray(search.constraints))
      throw new Error("AutoRecycler freshness query has no constraints");
    // A slightly wider server filter retains the exact inclusive boundary.
    search.constraints.push({
      key: "added_date_date",
      constraint_type: "greater than",
      value: asOf - AUTORECYCLER_FRESHNESS_MS - 1,
    });
    search.constraints.push({
      key: "added_date_date",
      constraint_type: "less than",
      value: asOf + 1,
    });
    const parsed = AutorecyclerInventoryPage.parse(
      await fetchPage(body),
      before,
    );
    if (!parsed.ok)
      throw new Error(
        `AutoRecycler freshness discovery failed: ${parsed.detail}`,
      );
    for (const hit of parsed.hits) {
      const src = hit._source;
      if (!src) continue;
      const date = src.added_date_date;
      const org =
        typeof src.organization_custom_organization === "string"
          ? src.organization_custom_organization
              .trim()
              .replace(/^\d+__LOOKUP__/, "")
          : "";
      const year = parseAutorecyclerNameText(
        src.name_text,
        src.vehicle_year_number,
      )?.year;
      if (
        /^\d+x\d+$/.test(org) &&
        typeof date === "number" &&
        isFreshAutorecyclerDate(date, asOf) &&
        typeof src.vin_text === "string" &&
        inventoryVin(src.vin_text, String(year ?? ""))
      )
        legacy[org] = Math.max(legacy[org] ?? -Infinity, date);
    }
    if (parsed.lastId === null)
      return {
        asOf,
        legacy,
        eligibleYards: Object.keys(legacy).map(
          (id) => `1348695171700984260__LOOKUP__${id}`,
        ),
      };
    before = parsed.lastId;
  }
  throw new Error(
    "AutoRecycler freshness discovery exceeded 1,000 pages. Published inventory is preserved; inspect the feed before retrying.",
  );
}
