import type { Yard } from "~/lib/yard";

export const SIX03_ORIGIN = "https://603autosalvage.com";
export const SIX03_CATALOG = SIX03_ORIGIN + "/parts-vehicles/";
export const SIX03_CONTACT = SIX03_ORIGIN + "/contact-us/";
export const SIX03_YARD = {
  source: "six03",
  code: "plaistow",
  name: "603 Auto Salvage",
  operator: "603 Auto Salvage",
  address: "233 Main St",
  city: "Plaistow",
  state: "NH",
  postalCode: "03865",
  phone: "603-392-7313",
  email: "parts@603autosalvage.com",
  lat: 42.8545693,
  lng: -71.1094333,
  websiteUrl: SIX03_ORIGIN,
} as const satisfies Omit<Yard, "source"> & { source: "six03" };
export type Six03Yard = typeof SIX03_YARD;

// Conflicting generic Organization metadata is retained as evidence. It does
// not establish another yard or replace the native Visit Us / named map marker.
export const SIX03_CONFLICTING_ORGANIZATION = {
  address: "5 Westville Road, Plaistow, NH 03865",
  lat: 42.8365,
  lng: -71.0948,
} as const;

/** The WordPress REST collection behind the catalog. One page carries every
 * donor's full Unit Data article; descending ids give a total order, so a
 * donor added or removed between page reads repeats or skips an id. */
export const SIX03_REST_PAGE_SIZE = 100;
export const SIX03_MAX_REST_PAGES = 12;
export function six03RestPageUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > SIX03_MAX_REST_PAGES)
    throw new Error(
      `603 REST page ${page} is outside its 1-${SIX03_MAX_REST_PAGES} census`,
    );
  return `${SIX03_ORIGIN}/wp-json/wp/v2/parts-vehicles?per_page=${SIX03_REST_PAGE_SIZE}&page=${page}&orderby=id&order=desc&_fields=id,slug,link,title,content`;
}
export function six03RestPage(raw: string): number | null {
  for (let page = 1; page <= SIX03_MAX_REST_PAGES; page++)
    if (raw === six03RestPageUrl(page)) return page;
  return null;
}

export function six03DonorPath(raw: string): string | null {
  const url = URL.parse(raw);
  return url &&
    url.origin === SIX03_ORIGIN &&
    url.href === raw &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/parts-vehicles\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(url.pathname)
    ? url.pathname
    : null;
}
