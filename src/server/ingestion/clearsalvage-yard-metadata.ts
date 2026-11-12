import type { Yard } from "~/lib/yard";

export const CLEARSALVAGE_ORIGIN = "https://clearsalvage.com";
export const CLEARSALVAGE_CATALOG =
  CLEARSALVAGE_ORIGIN + "/wp-json/wp/v2/inventory";
export const CLEARSALVAGE_MAX_PAGES = 32;
export const CLEARSALVAGE_PAGE_SIZE = 100;
export const CLEARSALVAGE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// Native named-business directions target, not its map viewport. Accuracy unstated.
// Native notice: Clear Salvage is now Sims Metal, DuBois, with the same people/service.
export const CLEARSALVAGE_YARD = {
  source: "clearsalvage",
  code: "dubois",
  name: "Clear Salvage LLC",
  operator: "Sims Metal",
  address: "2608 Carson Hill Road",
  city: "DuBois",
  state: "PA",
  postalCode: "15801",
  phone: "814-583-5128",
  email: null,
  lat: 41.0776428,
  lng: -78.7537367,
  websiteUrl: CLEARSALVAGE_ORIGIN + "/vehicle-inventory/",
} as const satisfies Omit<Yard, "source"> & { source: "clearsalvage" };
export type ClearsalvageYard = typeof CLEARSALVAGE_YARD;

export function clearsalvageCatalogUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > CLEARSALVAGE_MAX_PAGES)
    throw new Error(
      "Clear Salvage catalog page is outside the supported 1-32 range",
    );
  return (
    CLEARSALVAGE_CATALOG + `?per_page=100&page=${page}&orderby=id&order=asc`
  );
}
export function clearsalvageCatalogPage(raw: string): number | null {
  const match =
    /^https:\/\/clearsalvage\.com\/wp-json\/wp\/v2\/inventory\?per_page=100&page=([1-9]\d?)&orderby=id&order=asc$/.exec(
      raw,
    );
  const page = Number(match?.[1]);
  return match && page <= CLEARSALVAGE_MAX_PAGES ? page : null;
}
export function isClearsalvageDonorUrl(raw: string): boolean {
  return /^https:\/\/clearsalvage\.com\/inventory\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(
    raw,
  );
}
