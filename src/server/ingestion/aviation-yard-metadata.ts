import type { Yard } from "~/lib/yard";

export const AVIATION_ORIGIN = "https://aviationauto.com";
export const AVIATION_ROOT = AVIATION_ORIGIN + "/";
export const AVIATION_PARTS = AVIATION_ORIGIN + "/parts/";
export const AVIATION_CONTACT = AVIATION_ORIGIN + "/contact/";
export const AVIATION_MAKES = AVIATION_ORIGIN + "/used-parts/makes/";
export const AVIATION_IMAGE_PREFIX =
  "https://da8h1v3w8q6n5.cloudfront.net/az30/images/";

// Official contact address/phone and address-bound native map. Coordinates are
// the matching ASYD business point (row 1187), not a map viewport or image ID.
export const AVIATION_YARD = {
  source: "aviation",
  code: "tucson",
  name: "Aviation Auto Salvage",
  operator: "Aviation Auto Salvage",
  address: "5231 East Drexel",
  city: "Tucson",
  state: "AZ",
  postalCode: "85706",
  phone: "520-574-1700",
  email: "doug@aviationauto.com",
  lat: 32.14894,
  lng: -110.88075,
  websiteUrl: AVIATION_ROOT,
} as const satisfies Omit<Yard, "source"> & { source: "aviation" };
export type AviationYard = typeof AVIATION_YARD;

/** Paths are retained literally from native links, never synthesized from YMM. */
export function aviationBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== AVIATION_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.endsWith("/") ||
    !/^\/used-parts\/[^/]+(?:\/[^/]+)?$/.test(url.pathname) ||
    url.pathname.split("/").length !== depth + 2
  )
    return null;
  return url.pathname;
}
