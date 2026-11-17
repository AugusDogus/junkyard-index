import type { Yard } from "~/lib/yard";

export const SPARTAN_OWNER = "https://www.spartanauto.parts/auto-catalog";
export const SPARTAN_API = "https://api.spartanauto.parts/api/vehicles";
export const SPARTAN_MINIMUM = 323;
export const SPARTAN_YARD = {
  source: "spartan",
  code: "inman",
  name: "Spartan Auto & Heavy Truck Parts",
  operator: "Spartan Auto & Heavy Truck Parts",
  address: "1555 Bishop Road",
  city: "Inman",
  state: "SC",
  postalCode: "29349",
  phone: "864-529-9400",
  email: "spartanautoparts@gmail.com",
  websiteUrl: "https://www.spartanauto.parts/",
  lat: 35.0532148,
  lng: -82.0641628,
} as const satisfies Yard;

export type SpartanKind = "auto" | "truck";
export function spartanPageUrl(kind: SpartanKind, page: number) {
  return `${SPARTAN_API}?type=${kind}&page=${page}`;
}
