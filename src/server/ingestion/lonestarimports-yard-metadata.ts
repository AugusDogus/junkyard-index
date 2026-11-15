import type { Yard } from "~/lib/yard";

export const LONESTARIMPORTS_ORIGIN = "https://www.lonestarimport.com";
export const LONESTARIMPORTS_DOCUMENTS = [
  "/",
  "/about",
  "/contact",
  "/new-arrivals",
] as const;
// Complete native opening and genuine closing: 2,532 active, nine rejects,
// 19 native sold/crush exclusions on 2026-11-15 UTC.
export const LONESTARIMPORTS_MINIMUM_INVENTORY = 2_000;
export const LONESTARIMPORTS_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const LONESTARIMPORTS_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
export const LONESTARIMPORTS_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
export const LONESTARIMPORTS_MAX_PAGES = 500;
export const LONESTARIMPORTS_MAX_REQUESTS = 2 * LONESTARIMPORTS_MAX_PAGES + 8;
export const LONESTARIMPORTS_YARD = {
  source: "lonestarimports",
  code: "houston",
  name: "Lonestar Imports",
  operator: "Lonestar Imports",
  address: "6621 Liberty Rd",
  city: "Houston",
  state: "TX",
  postalCode: "77028",
  phone: "713-785-5151",
  email: null,
  // Native root/contact's named Google place link, last !8m2!3d/!4d point.
  // The @ viewport, address point and placeholder footer embed are not used.
  lat: 29.7951041,
  lng: -95.2997656,
  websiteUrl: LONESTARIMPORTS_ORIGIN + "/",
} as const satisfies Omit<Yard, "source"> & { source: "lonestarimports" };
export type LonestarimportsYard = typeof LONESTARIMPORTS_YARD;
export function lonestarimportsPageUrl(page: number): string {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > LONESTARIMPORTS_MAX_PAGES
  )
    throw new Error(
      "Lonestar native page is outside the bounded published Load More protocol",
    );
  return `${LONESTARIMPORTS_ORIGIN}/api/new-arrivals?page=${page}`;
}
