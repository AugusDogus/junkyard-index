import type { Yard } from "~/lib/yard";

export const RIGHTWAY_ORIGIN = "https://rightwayautorecycling.com";
export const RIGHTWAY_INVENTORY_URL = RIGHTWAY_ORIGIN + "/vehicle-search/";
// 2.5.11 (2026-11-18 upgrade) serves the same sha256-pinned body as 2.5.10.
export const RIGHTWAY_SCRIPT_PATH =
  "/wp-content/plugins/wp-inventory-manager/js/wpinventory.js?ver=2.5.11";

// Official root confirms this physical address and phone. Coordinates are from
// its matching saved ASYD business profile, not a map viewport or inferred town.
export const RIGHTWAY_YARD = {
  source: "rightway",
  code: "decaturville",
  name: "Rightway Auto Recycling",
  operator: "Rightway Auto Recycling",
  address: "7945 TN-100 W",
  city: "Decaturville",
  state: "TN",
  postalCode: "38329",
  phone: "731-549-3179",
  email: null,
  lat: 35.5290422,
  lng: -88.2404327,
  websiteUrl: RIGHTWAY_INVENTORY_URL,
} as const satisfies Yard;
export type RightwayYard = typeof RIGHTWAY_YARD;
