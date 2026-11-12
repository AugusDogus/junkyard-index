import type { Yard } from "~/lib/yard";

export const UWRENCH_ORIGIN = "https://uwrenchandsave.com";
export const UWRENCH_INVENTORY_URL = UWRENCH_ORIGIN + "/inventory/";
export const UWRENCH_EMBED_URL =
  "https://vinplus.texnrewards.com/parts/uwrench";
const api = "https://inventory-search-api-581547763015.us-central1.run.app";
export const UWRENCH_SEARCH_URL = api + "/searchVehicleHttp";
export const UWRENCH_CONFIG_URL = api + "/api/yard-info/uwrench";
export const UWRENCH_ANALYTICS_URL =
  api + "/api/analytics/year-distribution?yard_id=tri_state_u_wrench_and_save";

// Exact native name/address/phone and the matching third-party business record,
// Place ID ChIJN86PmQSLd4gRA18P0tAKUUA. The Kansas City directory point is rejected.
export const UWRENCH_YARD = {
  source: "uwrench",
  code: "uwrench",
  name: "Tri-State U-Wrench and Save",
  operator: "Tri-State U-Wrench and Save",
  address: "3310 Old Cape Rd",
  city: "Jackson",
  state: "MO",
  postalCode: "63755",
  phone: "573-987-3322",
  email: "info@uwrenchandsave.com",
  lat: 37.3637585,
  lng: -89.6281433,
  websiteUrl: UWRENCH_INVENTORY_URL,
} as const satisfies Omit<Yard, "source"> & { source: "uwrench" };
export type UwrenchYard = typeof UWRENCH_YARD;
