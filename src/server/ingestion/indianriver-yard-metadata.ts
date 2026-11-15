import type { Yard } from "~/lib/yard";

export const INDIANRIVER_ORIGIN = "https://indianriverautosalvage.com";
export const INDIANRIVER_OWNER = INDIANRIVER_ORIGIN + "/";
export const INDIANRIVER_CATALOG = INDIANRIVER_ORIGIN + "/inventory-3/";
export const INDIANRIVER_PAGE_SIZE = 500;
export const INDIANRIVER_MAX_PAGES = 20;
export const INDIANRIVER_MINIMUM_UNIQUE_INVENTORY = 900;
export type IndianriverYard = Omit<Yard, "source"> & { source: "indianriver" };

// Native address/phone and Census exact-address match, saved 2026-11-15 UTC in
// research/ga_fl_al/refill/indianriver-*. This is an address-range point.
export const INDIANRIVER_YARD = {
  source: "indianriver",
  code: "vero-beach",
  name: "Indian River U-Pull-It",
  operator: "Indian River U-Pull-It",
  address: "4600 45th St",
  city: "Vero Beach",
  state: "FL",
  postalCode: "32967",
  phone: "772-569-1563",
  email: "irscrapmetal@yahoo.com",
  lat: 27.675247000555,
  lng: -80.432334987156,
  websiteUrl: INDIANRIVER_OWNER,
} as const satisfies IndianriverYard;

export function indianriverPageUrl(index: number): string {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= INDIANRIVER_MAX_PAGES
  )
    throw new Error(
      "Indian River page index is outside the bounded native census",
    );
  if (index === 0) return INDIANRIVER_CATALOG;
  // Exact published query and observed canonical 301 target. Preserve every
  // scope/filter parameter, including empty values and native ordering.
  return (
    INDIANRIVER_CATALOG +
    "?inventory_page=" +
    index +
    "&status=0&status_all=0&status_label=Status&sort_label=Sort+By&categories=1&button=Search&search_label=Search+For&inventory_search=&sortby=inventory_number&sortdir=&inventory_sort_by=inventory_number&inventory_category_id=&inventory_status="
  );
}
