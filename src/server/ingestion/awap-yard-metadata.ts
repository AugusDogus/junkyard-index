import type { Yard } from "~/lib/yard";

export const AWAP_ORIGIN = "https://www.alwholesaleautoparts.com";
export const AWAP_CATALOG = AWAP_ORIGIN + "/cars-at-yard/";
export const AWAP_ABOUT = AWAP_ORIGIN + "/about/";

// Native About binds Birmingham, ZIP, phone and domain. Street and coordinates
// come from the matching named-business Maps item, place ID
// ChIJL2jNYdkdiYgRwAfdVKFRRuk. Native street is unpublished; point accuracy
// is unstated. The current 256-yard independent review found no physical alias.
export const AWAP_YARD = {
  source: "awap",
  code: "birmingham",
  name: "Alabama Wholesale Auto Parts",
  operator: "Alabama Wholesale Auto Parts",
  address: "120 Princeton Pkwy",
  city: "Birmingham",
  state: "AL",
  postalCode: "35211",
  phone: "205-538-2538",
  email: null,
  lat: 33.502776,
  lng: -86.8482328,
  websiteUrl: AWAP_ORIGIN + "/",
} as const satisfies Omit<Yard, "source"> & { source: "awap" };
export type AwapYard = typeof AWAP_YARD;

export function awapCatalogPage(raw: string): number | null {
  if (raw === AWAP_CATALOG) return 1;
  const match =
    /^https:\/\/www\.alwholesaleautoparts\.com\/cars-at-yard\/page\/([1-9]\d*)\/$/.exec(
      raw,
    );
  const page = Number(match?.[1]);
  return Number.isSafeInteger(page) && page >= 2 && page <= 32 ? page : null;
}
export const isAwapDonorUrl = (raw: string) =>
  /^https:\/\/www\.alwholesaleautoparts\.com\/cars-at-yard\/[a-z0-9-]+\/$/.test(
    raw,
  ) &&
  awapCatalogPage(raw) === null &&
  raw !== AWAP_CATALOG;

export function awapImage(raw: string | null): string | null {
  if (raw === null || raw.length > 2000) return null;
  const url = URL.parse(raw);
  return url &&
    url.origin === AWAP_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/wp-content\/uploads\/.+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)
    ? raw
    : null;
}
