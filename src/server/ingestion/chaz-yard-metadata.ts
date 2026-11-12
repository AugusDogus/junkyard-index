import type { Yard } from "~/lib/yard";

export const CHAZ_ORIGIN = "https://www.chazsauto.com";
export const CHAZ_ROOT = CHAZ_ORIGIN + "/recent-arrivals/";
export const CHAZ_CONTACT = CHAZ_ORIGIN + "/contact/";
export const CHAZ_MAKES = CHAZ_ORIGIN + "/parts/makes/";
export const CHAZ_IMAGE_PREFIX =
  "https://da8h1v3w8q6n5.cloudfront.net/md08/images/";

// Named-business ASYD/Google place point, accuracy unstated. Native address,
// domain and phone match. The ARA directory's alternative point is preserved
// in the qualification evidence; the native map viewport is not a yard point.
export const CHAZ_YARD = {
  source: "chaz",
  code: "taneytown",
  name: "Chaz's Used Auto Parts & Towing",
  operator: "Chaz's Used Auto Parts & Towing",
  address: "6035 Taneytown Pike",
  city: "Taneytown",
  state: "MD",
  postalCode: "21787",
  phone: "410-876-7815",
  email: null,
  lat: 39.6747856,
  lng: -77.2116775,
  websiteUrl: CHAZ_ORIGIN + "/",
} as const satisfies Omit<Yard, "source"> & { source: "chaz" };
export type ChazYard = typeof CHAZ_YARD;

/** Preserve literal native paths, including model punctuation and slashes. */
export function chazBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = URL.parse(raw, CHAZ_ORIGIN);
  if (
    !url ||
    url.origin !== CHAZ_ORIGIN ||
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
