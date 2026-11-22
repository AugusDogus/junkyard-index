import type { Yard } from "~/lib/yard";

export const PICKAPARTVA_ORIGIN = "https://pickapartva.com";
export const PICKAPARTVA_CATALOG = `${PICKAPARTVA_ORIGIN}/inventory/ANY/ANY/?k=1&id=ANY&pagenum=1`;
export const PICKAPARTVA_MAX_PAGES = 15;
export const PICKAPARTVA_PAGE_SIZE = 500;
/** Each page boundary can split at most one Set Date tie, so a census needs at
 * most one set-date search per boundary. */
export const PICKAPARTVA_MAX_TIE_SEARCHES = PICKAPARTVA_MAX_PAGES - 1;
export type PickapartvaYardCode = "TT87" | "UU81";

// Native footer/selector ownership, corroborated by the saved exact-address
// U-Pull Scan JSON-LD maps. Storage prefixes alone never establish geography.
export const PICKAPARTVA_YARDS = {
  TT87: {
    source: "pickapartva",
    code: "TT87",
    name: "Pick-A-Part Recycled Auto Parts - Fredericksburg",
    operator: "Pick-A-Part Recycled Auto Parts",
    address: "9001 Patriot Hwy",
    city: "Fredericksburg",
    state: "VA",
    postalCode: "22407",
    phone: "540-693-1028",
    email: null,
    lat: 38.271385,
    lng: -77.492726,
    websiteUrl: PICKAPARTVA_CATALOG,
  },
  UU81: {
    source: "pickapartva",
    code: "UU81",
    name: "Pick-A-Part Recycled Auto Parts - Stafford",
    operator: "Pick-A-Part Recycled Auto Parts",
    address: "164 Norman Rd.",
    city: "Stafford",
    state: "VA",
    postalCode: "22554",
    phone: "540-659-6800",
    email: null,
    lat: 38.461178,
    lng: -77.363489,
    websiteUrl: PICKAPARTVA_CATALOG,
  },
} as const satisfies Record<PickapartvaYardCode, Yard>;
export type PickapartvaYard = (typeof PICKAPARTVA_YARDS)[PickapartvaYardCode];

export function pickapartvaPageUrl(raw: string, page?: number): string | null {
  const url = URL.parse(raw, PICKAPARTVA_ORIGIN);
  if (
    !url ||
    url.origin !== PICKAPARTVA_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== "/inventory/ANY/ANY/"
  )
    return null;
  const number = url.searchParams.get("pagenum") ?? "";
  if (
    !/^[1-9]\d*$/.test(number) ||
    Number(number) > PICKAPARTVA_MAX_PAGES ||
    (page !== undefined && Number(number) !== page)
  )
    return null;
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 3 ||
    url.searchParams.get("k") !== "1" ||
    url.searchParams.get("id") !== "ANY" ||
    new Set(entries.map(([key]) => key)).size !== 3
  )
    return null;
  return url.href;
}

/** A real calendar date in the native `YYYY-MM-DD` Set Date format. */
export function pickapartvaSetDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const value = new Date(raw + "T00:00:00.000Z");
  return (
    Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === raw
  );
}

/** The physical scope of a native set-date search: every yard, or one yard
 * through the native `id` query parameter. The path's first segment is the
 * make, not the yard. */
export type PickapartvaSearchScope = "ANY" | PickapartvaYardCode;
export const PICKAPARTVA_YARD_CODES = [
  "TT87",
  "UU81",
] as const satisfies readonly PickapartvaYardCode[];
const searchScopes: readonly string[] = ["ANY", ...PICKAPARTVA_YARD_CODES];

/** A native make selector value such as `FORD`, `LAND ROVER` or
 * `MERCEDES-BENZ`. `ANY` is the unfiltered make. */
export const PICKAPARTVA_MAKE = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;
/** The native make selector lists 62 makes (November 22, 2026). */
export const PICKAPARTVA_MAX_MAKES = 100;
/** The native make path segment: spaces become underscores, as in the live
 * `/inventory/LAND_ROVER/ANY/` search (the same iis-pro-upull plugin as
 * Midway). */
export const pickapartvaMakePath = (make: string) => make.replaceAll(" ", "_");

/** The native search for one Set Date across every yard, within one yard, or
 * for one make within one yard, or null for anything else. `make` is the
 * expected make: `ANY` unless a make split asks for one. */
export function pickapartvaSearchUrl(
  raw: string,
  date?: string,
  id?: PickapartvaSearchScope,
  make = "ANY",
): string | null {
  const url = URL.parse(raw, PICKAPARTVA_ORIGIN);
  if (
    !url ||
    url.origin !== PICKAPARTVA_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    (make !== "ANY" && (make.length > 40 || !PICKAPARTVA_MAKE.test(make))) ||
    url.pathname !== `/inventory/${pickapartvaMakePath(make)}/ANY/`
  )
    return null;
  const search = url.searchParams.get("search") ?? "";
  const scope = url.searchParams.get("id") ?? "";
  const entries = [...url.searchParams.entries()];
  if (
    !pickapartvaSetDate(search) ||
    (date !== undefined && search !== date) ||
    !searchScopes.includes(scope) ||
    (id !== undefined && scope !== id) ||
    // A make split narrows one yard's search, never the unfiltered one.
    (make !== "ANY" && scope === "ANY") ||
    entries.length !== 3 ||
    url.searchParams.get("k") !== "1" ||
    new Set(entries.map(([key]) => key)).size !== 3
  )
    return null;
  return url.href;
}

export const pickapartvaSearchHref = (
  date: string,
  id: PickapartvaSearchScope = "ANY",
  make = "ANY",
) =>
  pickapartvaSearchUrl(
    `/inventory/${pickapartvaMakePath(make)}/ANY/?k=1&id=${id}&search=${date}`,
    date,
    id,
    make,
  );

export interface PickapartvaSearchTarget {
  date: string;
  id: PickapartvaSearchScope;
  make: string;
}
/** The Set Date, yard and make a native search URL asks for, or null when it
 * is not a valid set-date search. */
export function pickapartvaSearchTarget(
  raw: string,
): PickapartvaSearchTarget | null {
  const url = URL.parse(raw, PICKAPARTVA_ORIGIN);
  const segment = url?.pathname.split("/")[2] ?? "";
  const make = segment.replaceAll("_", " ");
  const date = url?.searchParams.get("search") ?? "";
  const id = url?.searchParams.get("id");
  const scope = PICKAPARTVA_YARD_CODES.find((code) => code === id) ?? "ANY";
  return pickapartvaSearchUrl(raw, date, scope, make) === raw
    ? { date, id: scope, make }
    : null;
}

/**
 * Whether these search URLs, in order, are the native searches that cover
 * their repeated Set Dates. Each date's searches are contiguous and are the
 * unfiltered search, or for each yard in order either that yard's search or,
 * once it reached the 500-card cap, one search per distinct make in that
 * yard. Which makes a split must cover is checked against the native make
 * selector where the catalog is at hand.
 */
export function pickapartvaSearchPlan(urls: readonly string[]): boolean {
  const targets: PickapartvaSearchTarget[] = [];
  const dates: string[] = [];
  for (const url of urls) {
    const target = pickapartvaSearchTarget(url);
    if (target === null) return false;
    targets.push(target);
    if (dates.at(-1) !== target.date) dates.push(target.date);
  }
  if (new Set(dates).size !== dates.length) return false;
  return dates.every((date) => {
    const searches = targets.filter((target) => target.date === date);
    if (searches.length === 1 && searches[0]?.id === "ANY") return true;
    const yards = PICKAPARTVA_YARD_CODES.map((id) =>
      searches.filter((target) => target.id === id),
    );
    return (
      JSON.stringify(searches) === JSON.stringify(yards.flat()) &&
      yards.every((yard) => {
        const makes = yard.map((target) => target.make);
        return (
          (makes.length === 1 && makes[0] === "ANY") ||
          (makes.length > 0 &&
            makes.length <= PICKAPARTVA_MAX_MAKES &&
            !makes.includes("ANY") &&
            new Set(makes).size === makes.length)
        );
      })
    );
  });
}
