import type { Yard } from "~/lib/yard";

export const FENIX_ORIGIN = "https://fenixupull.com";
export const FENIX_INVENTORY_URL = FENIX_ORIGIN + "/recent-inventory/";
export const FENIX_YARD_CODES = [
  "elmira",
  "binghamton",
  "east-syracuse",
] as const;
export type FenixYardCode = (typeof FENIX_YARD_CODES)[number];

// Native addresses/contacts, 2026-11-12. Elmira and Binghamton business points
// come from exact-address ARA directory members 2977 and 2975. Their native
// directions publish map view centers, retained separately below. Syracuse
// publishes an explicit Google Maps business pin in its native location card.
export const FENIX_YARDS = {
  elmira: {
    source: "fenix",
    code: "elmira",
    name: "Fenix U-Pull Elmira",
    operator: "Fenix U-Pull",
    address: "1592 Sears Road",
    city: "Elmira",
    state: "NY",
    postalCode: "14903",
    phone: "+16077393851",
    email: "info@fenixupull.com",
    websiteUrl: FENIX_ORIGIN + "/elmira-ny?setLocation=elmira-ny",
    lat: 42.156052,
    lng: -76.8627312,
  },
  binghamton: {
    source: "fenix",
    code: "binghamton",
    name: "Fenix U-Pull Binghamton",
    operator: "Fenix U-Pull",
    address: "230 Colesville Rd",
    city: "Binghamton",
    state: "NY",
    postalCode: "13904",
    phone: "+16077751900",
    email: "info@fenixupull.com",
    websiteUrl: FENIX_ORIGIN + "/binghamton-ny?setLocation=binghamton-ny",
    lat: 42.1094648,
    lng: -75.8217977,
  },
  "east-syracuse": {
    source: "fenix",
    code: "east-syracuse",
    name: "Fenix U-Pull East Syracuse",
    operator: "Fenix U-Pull",
    address: "7030 Myers Road",
    city: "East Syracuse",
    state: "NY",
    postalCode: "13057",
    phone: "+13156567533",
    email: "info@fenixupull.com",
    websiteUrl: FENIX_ORIGIN + "/east-syracuse-ny?setLocation=east-syracuse-ny",
    lat: 43.094055,
    lng: -76.037907,
  },
} as const satisfies Record<FenixYardCode, Yard>;

export const FENIX_LOCATION_PREFERENCES = {
  elmira: "1",
  binghamton: "2",
  "east-syracuse": "3",
} as const;

export const FENIX_NATIVE_MAP_COORDINATES = {
  elmira: { lat: 42.15589, lng: -76.86269 },
  binghamton: { lat: 42.108492, lng: -75.820253 },
  "east-syracuse": { lat: 43.094055, lng: -76.037907 },
} as const;

export function validateFenixYards(html: string): Yard[] {
  const cards = html
    .split(/<div\b[^>]*class="fnx-ls-location-card"[^>]*>/i)
    .slice(1);
  for (const yard of Object.values(FENIX_YARDS)) {
    const card = cards.filter((value) => value.includes(`>${yard.city}</div>`));
    const value = card[0];
    const phone = value?.match(/href="tel:([^"]+)"/i)?.[1]?.replace(/\D/g, "");
    const native = FENIX_NATIVE_MAP_COORDINATES[yard.code];
    const pin =
      yard.code === "east-syracuse"
        ? `!3d${native.lat}!4d${native.lng}`
        : `ll=${native.lat},${native.lng}`;
    if (
      card.length !== 1 ||
      !value?.includes(`>${yard.address}</div>`) ||
      !value.includes(`>${yard.city}, NY ${yard.postalCode}</div>`) ||
      !value.includes(pin) ||
      phone !== yard.phone.slice(2) ||
      !value.includes(yard.websiteUrl.slice(FENIX_ORIGIN.length))
    )
      throw new Error(
        "Fenix physical contact or coordinate provenance changed for " +
          yard.code,
      );
  }
  return Object.values(FENIX_YARDS);
}
