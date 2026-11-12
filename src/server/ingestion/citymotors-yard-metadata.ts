import type { Yard } from "~/lib/yard";

export const CITYMOTORS_ORIGIN = "https://citymotorsparts.com";
export const CITYMOTORS_CATALOG = CITYMOTORS_ORIGIN + "/used-car-parts/cars/";
// Native AutoPartsStore JSON-LD agrees with visible footer/address/phone.
export const CITYMOTORS_YARD = {
  source: "citymotors",
  code: "river-grove",
  name: "City Motors Chicago",
  operator: "City Motors Parts",
  address: "2150 West St",
  city: "River Grove",
  state: "IL",
  postalCode: "60171",
  phone: "708-395-5602",
  email: null,
  lat: 41.9274,
  lng: -87.8398,
  websiteUrl: CITYMOTORS_CATALOG,
} as const satisfies Omit<Yard, "source"> & { source: "citymotors" };
export type CitymotorsYard = typeof CITYMOTORS_YARD;

export function citymotorsCatalogPage(raw: string): number | null {
  if (raw === CITYMOTORS_CATALOG) return 1;
  const match =
    /^https:\/\/citymotorsparts\.com\/used-car-parts\/cars\/\?page-number=([1-9]\d?)$/.exec(
      raw,
    );
  const number = Number(match?.[1]);
  return match && number >= 2 && number <= 32 ? number : null;
}
export function isCitymotorsDonorUrl(raw: string): boolean {
  return /^https:\/\/citymotorsparts\.com\/cars\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(
    raw,
  );
}
export function citymotorsImage(raw: string | null): string | null {
  return raw &&
    /^https:\/\/citymotorsparts\.com\/wp-content\/uploads\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(
      raw,
    ) &&
    !raw.includes("/../")
    ? raw
    : null;
}
