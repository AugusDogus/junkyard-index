import type { Yard } from "~/lib/yard";

export const ALSAUTO_CATALOG =
  "https://www.alsautosalvagewi.com/latest-inventory";
export const ALSAUTO_API =
  "https://www.alsautosalvagewi.com/index.php?route=extension/module/als_vehicles_widget/filter";
// 693 accepted out of 703 native donors in the November 17, 2026 census.
export const ALSAUTO_MINIMUM_INVENTORY = 231;
export const ALSAUTO_MAX_PAGES = 40;
export const ALSAUTO_MAX_REQUESTS = 2 + 2 * ALSAUTO_MAX_PAGES;
export const ALSAUTO_MAX_BODY_BYTES = 256 * 1024;
export const ALSAUTO_YARD = {
  source: "alsauto",
  code: "franklin",
  name: "Al's Auto Salvage",
  operator: "Al's Auto Salvage",
  address: "10942 S 124th Street",
  city: "Franklin",
  state: "WI",
  postalCode: "53132",
  phone: "414-425-1890",
  email: "alsautosales@gmail.com",
  // Census onelineaddress, exact native street address match, November 17, 2026.
  lat: 42.854344204484,
  lng: -88.069801192946,
  websiteUrl: ALSAUTO_CATALOG,
} as const satisfies Omit<Yard, "source"> & { source: "alsauto" };
export type AlsautoYard = typeof ALSAUTO_YARD;
export const alsautoPageUrl = (page: number): string => {
  if (!Number.isSafeInteger(page) || page < 1 || page > ALSAUTO_MAX_PAGES)
    throw new Error("Al's page is outside the qualified 1-40 range");
  return `${ALSAUTO_API}&page=${page}`;
};
