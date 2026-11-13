import type { Yard } from "~/lib/yard";

export const MEEKS_ORIGIN = "https://meeksrecycling.com";
export const MEEKS_INVENTORY_URL =
  "https://meeksrecycling.com/pic-and-pull-inventory/";
export const MEEKS_FULL_INVENTORY_URL =
  "https://meeksrecycling.com/pic-and-pull/";

// Native root binds 1205 to Pic-N-Pull. AK56 independently locates this
// address, separately from the recycling facility at 1331 Virginia Avenue.
export const MEEKS_YARD = {
  source: "meeks",
  code: "martinsville",
  name: "Meeks Pic-N-Pull",
  operator: "Meeks Recycling and Salvage LLC",
  address: "1205 Virginia Ave",
  city: "Martinsville",
  state: "VA",
  postalCode: "24112",
  websiteUrl: MEEKS_ORIGIN + "/",
  email: null,
  phone: "276-638-0710",
  lat: 36.6977581,
  lng: -79.90064989999999,
} as const satisfies Yard;
