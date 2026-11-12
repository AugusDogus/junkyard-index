import type { Yard } from "~/lib/yard";

export const PIPES_ORIGIN = "https://www.pipesupullit.net";
export const PIPES_INVENTORY_URL = PIPES_ORIGIN + "/Home/Inventory";
export const PIPES_DIRECTIONS_URL = PIPES_ORIGIN + "/Home/Directions";
export const PIPES_EMBED_URL =
  "https://vinplus.texnrewards.com/parts/pipes-shreveport";
const api = "https://inventory-search-api-581547763015.us-central1.run.app";
export const PIPES_CONFIG_URL = api + "/api/yard-info/pipes_shreveport";
export const PIPES_SEARCH_URL = api + "/searchVehicleHttp";
export const PIPES_LOCATION_ID = "pipes_shreveport";
export const PIPES_API_OWNER = "tri_state_iron_metal";
export const PIPES_API_SITE = "Pipes Shreveport";

// Exact native map feature/CID, domain, address and phone match the independently
// reviewed business result. Aero707 and UAPI809 are separate physical yards.
export const PIPES_YARD = {
  source: "pipes",
  code: "shreveport",
  name: "Pipes U-Pull-It",
  operator: "Pipes U-Pull-It",
  address: "806 Aero Drive",
  city: "Shreveport",
  state: "LA",
  postalCode: "71107",
  phone: "318-222-9547",
  email: null,
  lat: 32.5299208,
  lng: -93.773648,
  websiteUrl: PIPES_INVENTORY_URL,
} as const satisfies Yard;
export type PipesYard = typeof PIPES_YARD;
