import type { Yard } from "~/lib/yard";

export const CSTRUCK_ORIGIN = "https://www.heavytruckparts.net";
export const CSTRUCK_CATALOG =
  CSTRUCK_ORIGIN + "/search/Any/Any/Complete-Vehicle?fltpc=7131988&store=1";
export const CSTRUCK_STORE =
  CSTRUCK_ORIGIN + "/search.php?fltpc=7131988&store=1";
export const CSTRUCK_MAX_REQUESTS = 40;
export const CSTRUCK_MAX_BYTES = 2 * 1024 * 1024;
export const CSTRUCK_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
export const CSTRUCK_RANGES = [
  [1970, 1998],
  [1999, 2003],
  [2004, 2006],
  [2007, 2027],
] as const;
export type CstruckRange = readonly [number, number];
export type CstruckQuery = CstruckRange | { page: number };
export const CSTRUCK_YARD = {
  source: "cstruck",
  code: "pukwana",
  name: "C&S Truck Sales & Salvage",
  operator: "C & S Truck Sales, LLC",
  address: "24988 350th Ave",
  city: "Pukwana",
  state: "SD",
  postalCode: "57370",
  phone: "605-894-4100",
  email: null,
  // Census Public_AR_Current exact match, 2026-11-15. TIGER 199152457,
  // right side, range 24998-24900. Address interpolation, not a city centroid.
  lat: 43.760066942433,
  lng: -99.182783487055,
  websiteUrl: "https://candstrucksales.com/",
} as const satisfies Yard;
export function cstruckRangeUrl(query: CstruckQuery): string {
  if ("page" in query) {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 15)
      throw new Error("C&S unfiltered page must be between 1 and 15");
    return `${CSTRUCK_CATALOG}&SortBy=year&Order=asc${query.page === 1 ? "" : `&page=${query.page}`}`;
  }
  const [start, end] = query;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1970 ||
    end > 2027 ||
    start > end
  )
    throw new Error(
      "C&S year range is outside the published 1970-2027 controls",
    );
  return `${CSTRUCK_CATALOG}&year_start=${start}&year_end=${end}`;
}
