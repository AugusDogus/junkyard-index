import type { Yard } from "~/lib/yard";

export const IDIPULL_ORIGIN = "https://ifipull.com";
export const IDIPULL_INVENTORY_URL = IDIPULL_ORIGIN + "/inventory/";
export const IDIPULL_MAP_URL =
  "https://www.google.com/maps/place/3015+N+15th+E,+Idaho+Falls,+ID+83401/@43.5230819,-112.0083947,17z/data=!3m1!4b1!4m5!3m4!1s0x53545c3122d97643:0xc45fa1630189e98c!8m2!3d43.523078!4d-112.006206";

// The native address anchor's !3d/!4d point identifies the yard. Its @viewport
// center is a different longitude and must not supply the inventory coordinates.
export const IDIPULL_YARD = {
  source: "idipull",
  code: "idaho-falls",
  name: "iPull by Intermountain Auto",
  operator: "Intermountain Auto",
  address: "3015 N 15th E",
  city: "Idaho Falls",
  state: "ID",
  postalCode: "83401",
  phone: "208-524-4461",
  email: "info@ifipull.com",
  lat: 43.523078,
  lng: -112.006206,
  websiteUrl: IDIPULL_INVENTORY_URL,
} as const satisfies Yard;
export type IdipullYard = typeof IDIPULL_YARD;
