import type { Yard } from "~/lib/yard";

export const BRANDYWINE_ORIGIN = "https://www.brandywineupullit.com";
// Exact published native controls, pinned in the saved qualification packet.
export const BRANDYWINE_ROOT = BRANDYWINE_ORIGIN + "/";
export const BRANDYWINE_MANUFACTURERS =
  BRANDYWINE_ORIGIN + "/veh_manufacturers/";
export const BRANDYWINE_INCOMING = BRANDYWINE_ORIGIN + "/incoming-vehicles/";
export const BRANDYWINE_FRESH = BRANDYWINE_ORIGIN + "/veh_new/";

// AL59: named U-Pull-It business point, distinct from Automotive Center.
// Native root binds this address and phone to the Brandywine Auto Parts block.
export const BRANDYWINE_YARD = {
  source: "brandywine",
  code: "brandywine",
  name: "Brandywine U-Pull-It",
  operator: "Brandywine Auto Parts",
  address: "14000 Crain Hwy",
  city: "Brandywine",
  state: "MD",
  postalCode: "20613",
  phone: "301-242-9494",
  email: null,
  lat: 38.69678,
  lng: -76.86962,
  websiteUrl: BRANDYWINE_ROOT,
} as const satisfies Omit<Yard, "source"> & { source: "brandywine" };
export type BrandywineYard = typeof BRANDYWINE_YARD;
