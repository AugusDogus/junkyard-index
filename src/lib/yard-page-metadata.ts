import type { Metadata } from "next";
import { InventoryFormat } from "./inventory-format";
import { MakeInventory } from "./make-inventory";
import { SITE_OPEN_GRAPH, SITE_TWITTER } from "./site-metadata";
import { VehicleName } from "./vehicle-name";
import { YARD_MAKE_INDEXABLE_MINIMUM } from "./yard-make-inventory";
import { YARD_PAGE_SIZE } from "./yard-inventory";
import { YardName } from "./yard-name";
import { YardPath } from "./yard-path";
import type { RoutedYard } from "~/server/yard-inventory";

type MetadataYard = Pick<
  RoutedYard,
  "name" | "operator" | "city" | "state" | "path"
>;

/** A make the page is narrowed to, by its national name and slug. */
export type YardMakeFilter = { name: string; slug: string };
export type YardModelFilter = YardMakeFilter & {
  model: { name: string; slug: string };
};

export function filterName(filter: YardMakeFilter | YardModelFilter): string {
  return "model" in filter
    ? VehicleName.title(filter.name, filter.model.name)
    : filter.name;
}
export function filterHref(
  yard: MetadataYard,
  filter: YardMakeFilter | YardModelFilter,
): string {
  return "model" in filter
    ? YardPath.modelHref(yard.path, filter.slug, filter.model.slug)
    : YardPath.makeHref(yard.path, filter.slug);
}

/** " Page 2, vehicles 101 to 200 of 271." after the first page, else "". */
function pageRange(total: number, page: number): string {
  return page > 1
    ? ` Page ${page}, vehicles ${InventoryFormat.count((page - 1) * YARD_PAGE_SIZE + 1)} to ${InventoryFormat.count(Math.min(total, page * YARD_PAGE_SIZE))} of ${InventoryFormat.count(total)}.`
    : "";
}

/** Title, description, and canonical URL for page `page` of a yard. */
export function yardPageMetadata(
  yard: MetadataYard,
  total: number,
  publishedAt: string | null,
  page: number,
): Metadata {
  const headline = YardName.headline(yard.name, yard.operator);
  const place = `${yard.city}, ${yard.state}`;
  const title =
    page === 1
      ? `${headline} Inventory | ${place}`
      : `${headline} Inventory, Page ${page} | ${place}`;
  const range = pageRange(total, page);
  const description = `${InventoryFormat.plural(total, "vehicle", "vehicles")} at ${headline} in ${place}, with the year, make, model, and VIN of each.${range}${
    publishedAt ? ` Updated ${InventoryFormat.date(publishedAt)}.` : ""
  }`;
  const url = YardPath.pageHref(yard.path, page);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...SITE_OPEN_GRAPH, type: "website", url, title, description },
    twitter: { ...SITE_TWITTER, title, description },
  };
}

/**
 * Title, description, and canonical URL for one make or model at a yard.
 * A make's list runs to more pages; a model's is one page.
 */
export function yardMakeMetadata(
  yard: MetadataYard,
  make: YardMakeFilter | YardModelFilter,
  total: number,
  publishedAt: string | null,
  page = 1,
): Metadata {
  const headline = YardName.headline(yard.name, yard.operator);
  const place = `${yard.city}, ${yard.state}`;
  const name = filterName(make);
  const title =
    page > 1
      ? `${name} at ${headline}, Page ${page} | ${place}`
      : `${name} at ${headline} | ${place}`;
  const description = `${InventoryFormat.plural(total, `${name} vehicle`, `${name} vehicles`)} at ${headline} in ${place}, with where each one sits in the yard.${pageRange(total, page)}${
    publishedAt ? ` Updated ${InventoryFormat.date(publishedAt)}.` : ""
  }`;
  const url =
    "model" in make
      ? filterHref(yard, make)
      : YardPath.makePageHref(yard.path, make.slug, page);
  return {
    title,
    description,
    alternates: { canonical: url },
    // A make with fewer than five vehicles at a yard is too thin to be a
    // search result. One model at one yard never is: about 21,000 would pass
    // that threshold and dilute crawling of the yard, make and model hubs
    // that already answer those searches. Their links are still followed.
    // Indexable pages leave robots out: an undefined key would still
    // replace the layout's googlebot preview limits.
    ...(("model" in make ||
      !MakeInventory.indexable(
        { count: total },
        YARD_MAKE_INDEXABLE_MINIMUM,
      )) && { robots: { index: false, follow: true } }),
    openGraph: { ...SITE_OPEN_GRAPH, type: "website", url, title, description },
    twitter: { ...SITE_TWITTER, title, description },
  };
}
