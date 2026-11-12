import type { Yard } from "~/lib/yard";

export const PICKERS_ORIGIN = "https://pickerstxk.com";
export const PICKERS_INVENTORY_URL = PICKERS_ORIGIN + "/Home/Inventory";
export const PICKERS_PRICES_URL = PICKERS_ORIGIN + "/Home/PartPrices";
export const PICKERS_APP_URL =
  "https://vinplus.texnrewards.com/parts/pickers-texarkana";
const api = "https://inventory-search-api-581547763015.us-central1.run.app";
export const PICKERS_CONFIG_URL = api + "/api/yard-info/pickers_texarkana";
export const PICKERS_SEARCH_URL = api + "/searchVehicleHttp";
export const PICKERS_OPERATOR_ID = "tri_state_iron_metal";
export const PICKERS_LOCATION_ID = "pickers_texarkana";

// Native address/phone establish Arkansas despite vendor location state TX.
// ASYD's address-bound business point agrees with the named AutoRecycler
// Texarkana point within 7.402 m. Neither Google's viewport nor the copied
// AutoRecycler Longview address supplies this yard's geography.
export const PICKERS_YARD = {
  source: "pickers",
  code: "pickers-texarkana",
  name: "Pickers Self-Service Auto Parts",
  operator: "Tri-State Iron & Metal",
  address: "5512 E 9th Street",
  city: "Texarkana",
  state: "AR",
  postalCode: "71854",
  phone: "870-772-1880",
  email: null,
  lat: 33.42952,
  lng: -93.97398,
  websiteUrl: PICKERS_INVENTORY_URL,
} as const satisfies Yard;
export type PickersYard = typeof PICKERS_YARD;
