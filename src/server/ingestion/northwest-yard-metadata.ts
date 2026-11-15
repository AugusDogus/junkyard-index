import type { Yard } from "~/lib/yard";
import { NORTHWEST_ORIGIN } from "./northwest-html";

export { NORTHWEST_ORIGIN, northwestBrowsePath } from "./northwest-html";
export const NORTHWEST_ROOT = NORTHWEST_ORIGIN + "/search-inventory/";
export const NORTHWEST_MAKES = NORTHWEST_ORIGIN + "/parts/makes/";

// US Census exact-address street-range match, 5500-5798 Camelot Drive.
export const NORTHWEST_YARD = {
  source: "northwest",
  code: "anchorage",
  name: "Northwest Auto Parts",
  operator: "Northwest Auto Parts",
  address: "5700 Camelot Drive",
  city: "Anchorage",
  state: "AK",
  postalCode: "99504",
  phone: "907-333-6531",
  email: null,
  lat: 61.220492673939,
  lng: -149.775910317066,
  websiteUrl: NORTHWEST_ORIGIN + "/",
} as const satisfies Omit<Yard, "source"> & { source: "northwest" };
export type NorthwestYard = typeof NORTHWEST_YARD;
