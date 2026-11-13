import type { Yard } from "~/lib/yard";

export const SPEEDYS_ORIGIN = "https://parts.speedysgroup.com";
export const SPEEDYS_CATALOG = SPEEDYS_ORIGIN + "/partingout/";
export const SPEEDYS_ALL = SPEEDYS_CATALOG + "?cat=0&pag=0";
export const SPEEDYS_MAX_DONORS = 256;
export const SPEEDYS_MAX_CATEGORIES = 32;
export const SPEEDYS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// Native catalog/detail address joins the exact named Google business point
// ChIJLdNenW8TsYkRiDiqH2AIVPA. Catalog phone differs from the Maps phone.
export const SPEEDYS_YARD = {
  source: "speedys",
  code: "richmond",
  name: "Speedy's Transmission",
  operator: "Speedy's Towing & Auto",
  address: "5300 Midlothian Turnpike",
  city: "Richmond",
  state: "VA",
  postalCode: "23225",
  phone: "804-999-1845",
  email: null,
  lat: 37.507737999999996,
  lng: -77.4950018,
  websiteUrl: SPEEDYS_CATALOG,
} as const satisfies Yard;
export type SpeedysYard = typeof SPEEDYS_YARD;

export function speedysCatalogCategory(raw: string): string | null {
  if (raw === SPEEDYS_CATALOG) return "default";
  return (
    /^https:\/\/parts\.speedysgroup\.com\/partingout\/\?cat=(0|[1-9]\d{0,8})&pag=0$/.exec(
      raw,
    )?.[1] ?? null
  );
}
export function speedysDonorId(raw: string): string | null {
  return (
    /^https:\/\/parts\.speedysgroup\.com\/car\/\?car=([1-9]\d{0,8})$/.exec(
      raw,
    )?.[1] ?? null
  );
}
