import type { Yard } from "~/lib/yard";

export const OEMGARAGE_ORIGIN = "https://oe-mgarage.com";
export const OEMGARAGE_CATALOG =
  OEMGARAGE_ORIGIN + "/collections/vehicles-dismantled";
export const OEMGARAGE_MAX_BYTES = 4 * 1024 * 1024;
export type OemgarageYard = Omit<Yard, "source"> & { source: "oemgarage" };
// Native address independently matched by Census on 2026-11-15. These are
// interpolated street-range coordinates (5800 through 5898), not a rooftop.
export const OEMGARAGE_YARD = {
  source: "oemgarage",
  code: "hollywood",
  name: "oeM Garage",
  operator: "oeM Garage / DOV Auto Sales",
  address: "5808 Dawson Street",
  city: "Hollywood",
  state: "FL",
  postalCode: "33023",
  phone: "954-882-3346",
  email: "Sales@oe-mgarage.com",
  websiteUrl: OEMGARAGE_ORIGIN,
  lat: 26.001031334919,
  lng: -80.203375411824,
} as const satisfies OemgarageYard;
