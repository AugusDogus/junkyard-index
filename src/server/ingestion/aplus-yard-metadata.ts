import type { Yard } from "~/lib/yard";

export const APLUS_ORIGIN = "https://aplusauto.parts";
export const APLUS_ROOT = APLUS_ORIGIN + "/latest-arrivals/";
export const APLUS_CONTACT = APLUS_ORIGIN + "/";
export const APLUS_MAKES = APLUS_ORIGIN + "/parts/makes/";
export const APLUS_IMAGE_PREFIX =
  "https://da8h1v3w8q6n5.cloudfront.net/qq91/images/";

// Qualified named-business Google/ASYD point, accuracy unstated. Native owner,
// address and domain corroborate it. The native address-feature map point and
// external Maps phone remain separate observations in qualification evidence.
export const APLUS_YARD = {
  source: "aplus",
  code: "nicholasville",
  name: "A Plus Auto LLC",
  operator: "A Plus Auto LLC",
  address: "2125 Catnip Hill Rd",
  city: "Nicholasville",
  state: "KY",
  postalCode: "40356",
  phone: "859-710-6294",
  email: null,
  lat: 37.9340629,
  lng: -84.559118,
  websiteUrl: APLUS_ORIGIN + "/",
} as const satisfies Omit<Yard, "source"> & { source: "aplus" };
export type AplusYard = typeof APLUS_YARD;

/** Preserve literal native paths, including model punctuation and slashes. */
export function aplusBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = URL.parse(raw, APLUS_ORIGIN);
  if (
    !url ||
    url.origin !== APLUS_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/parts\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname) ||
    url.pathname.split("/").filter(Boolean).length !== depth + 1 ||
    url.pathname.replace(/\/$/, "") === "/parts/makes"
  )
    return null;
  return url.pathname;
}
