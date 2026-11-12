import type { Yard } from "~/lib/yard";

export const JOLIET_ORIGIN = "https://www.jolietupullit.com";
export const JOLIET_INVENTORY_URL = JOLIET_ORIGIN + "/inventory";
export const JOLIET_CONTACT_URL = JOLIET_ORIGIN + "/contactus";
const api = "https://inventory-search-api-581547763015.us-central1.run.app";
export const JOLIET_SEARCH_URL = api + "/searchVehicleHttp";
export const JOLIET_CONFIG_URL = api + "/api/yard-info/joliet";
export const JOLIET_ANALYTICS_URL =
  api + "/api/analytics/year-distribution?yard_id=joliet_u_pull_it";
export const JOLIET_EMBED_URL = "https://vinplus.texnrewards.com/parts/joliet";

// Official body/footer/contact establish the owner. The root JSON-LD contains
// copied Littleton metadata and is excluded. Coordinates are the matching
// ASYD AutoPartsStore business geo, not a map viewport. See the runbook.
export const JOLIET_YARD = {
  source: "joliet",
  code: "joliet",
  name: "Joliet U-Pull-It",
  operator: "Joliet U-Pull-It",
  address: "1014 E. Washington Street",
  city: "Joliet",
  state: "IL",
  postalCode: "60433",
  phone: "815-723-3011",
  email: "jolietupullit@gmail.com",
  lat: 41.5224678,
  lng: -88.0560742,
  websiteUrl: JOLIET_INVENTORY_URL,
} as const satisfies Yard;
export type JolietYard = typeof JOLIET_YARD;
