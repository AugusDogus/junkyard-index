import type { Yard } from "~/lib/yard";
export const BIGD_ORIGIN = "https://bigdsalvage.com";
export const BIGD_INVENTORY_URL = BIGD_ORIGIN + "/inventory/";
export const BIGD_MINIMUM_INVENTORY = 96;
// Census Public_AR_Current matches the native contact address. The contact
// iframe queries 2396 rather than 1296 and is not coordinate evidence.
export const BIGD_YARD = {
  source: "bigd",
  code: "idaho-falls",
  name: "Big D Pick & Pull",
  address: "1296 E Iona Rd",
  city: "Idaho Falls",
  state: "ID",
  postalCode: "83401",
  phone: "208-522-1100",
  operator: null,
  email: null,
  lat: 43.525879698073,
  lng: -112.007922057112,
  websiteUrl: BIGD_INVENTORY_URL,
} as const satisfies Yard;
export type BigdYard = typeof BIGD_YARD;
