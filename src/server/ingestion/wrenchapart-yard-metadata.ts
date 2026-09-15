import { Yard } from "~/lib/yard";
import { normalizeRegion } from "./normalization";
import type { WrenchApartLocation } from "./wrenchapart-client";

export type WrenchApartYard = Yard & { source: "wrenchapart" };
export type LocatedWrenchApartYard = WrenchApartYard & {
  lat: number;
  lng: number;
};

export function wrenchapartYard(
  location: WrenchApartLocation,
): WrenchApartYard | null {
  const name = location.name?.trim();
  const city = location.city?.trim();
  const state = location.state?.trim();
  if (!name || !city || !state) return null;
  const region = normalizeRegion(state, null);
  if (!region.stateAbbr) return null;
  return {
    source: "wrenchapart",
    code: String(location.id),
    name: `Wrench-A-Part - ${name}`,
    operator: "Wrench-A-Part",
    address: location.street?.trim() || null,
    city,
    state: region.stateAbbr,
    postalCode: location.zip?.trim() || null,
    ...Yard.coordinates(location.geoLat ?? null, location.geoLng ?? null),
    websiteUrl: null,
    phone: location.phone?.trim() || null,
    email: null,
  };
}

export function wrenchapartPricesUrl(
  location: WrenchApartLocation,
): string | null {
  const slug = location.slug?.trim();
  return slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? `https://wrenchapart.com/${slug}-price-list.html`
    : null;
}
