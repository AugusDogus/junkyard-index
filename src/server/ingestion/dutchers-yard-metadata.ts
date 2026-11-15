import type { Yard } from "~/lib/yard";

export const DUTCHERS_ORIGIN = "https://www.heavytruckparts.net";
export const DUTCHERS_STORE =
  DUTCHERS_ORIGIN + "/search.php?fltpc=3987345&store=1";
export const DUTCHERS_SCOPE =
  "https://dutchersinc.com/fresh-heavy-duty-parts-vehicles/";
export const DUTCHERS_CATEGORY = "/search/Any/Any/Complete-Vehicle";
export const DUTCHERS_PAGE_SIZE = 25;
export const DUTCHERS_MAX_PAGES = 80;
export const DUTCHERS_MAX_BYTES = 2 * 1024 * 1024;
export type DutchersDirection = "DESC" | "ASC";

// Census Public_AR_Current exact-address match, 2026-11-15. Street-range
// interpolation on TIGER 46498168, right side, 4599-4401. Not a rooftop point.
// Saved receipt: research/ga_fl_al/refill04/dutchers-census-geocode.meta.json.
export const DUTCHERS_YARD = {
  source: "dutchers",
  code: "morrisville-heavy",
  name: "Dutcher's Inc Heavy Truck Division",
  operator: "Dutcher's Inc.",
  address: "4495 Cramer Road",
  city: "Morrisville",
  state: "NY",
  postalCode: "13408",
  phone: "315-684-9212",
  email: null,
  lat: 42.925718104003,
  lng: -75.631415836247,
  websiteUrl: DUTCHERS_SCOPE,
} as const satisfies Omit<Yard, "source"> & { source: "dutchers" };

export function dutchersCatalogUrl(direction: DutchersDirection, page: number) {
  if (!Number.isSafeInteger(page) || page < 1 || page > DUTCHERS_MAX_PAGES)
    throw new Error("Dutcher catalog page must be an integer from 1 to 80");
  return (
    DUTCHERS_ORIGIN +
    DUTCHERS_CATEGORY +
    "?fltpc=3987345&store=1&SortBy=year" +
    (direction === "ASC" ? "&Order=asc" : "") +
    (page > 1 ? "&page=" + page : "")
  );
}
