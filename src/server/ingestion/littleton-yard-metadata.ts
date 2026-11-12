import type { Yard } from "~/lib/yard";

export const LITTLETON_ORIGIN = "https://littletonupullit.com";
export const LITTLETON_INVENTORY_URL = LITTLETON_ORIGIN + "/vehicle-inventory";
export const LITTLETON_API_ORIGIN =
  "https://inventory-search-api-581547763015.us-central1.run.app";
export const LITTLETON_SEARCH_URL = LITTLETON_API_ORIGIN + "/searchVehicleHttp";
export const LITTLETON_CONFIG_URL =
  LITTLETON_API_ORIGIN + "/api/yard-info/littleton";
export const LITTLETON_ANALYTICS_URL =
  LITTLETON_API_ORIGIN +
  "/api/analytics/year-distribution?yard_id=littleton_u_pull_it";
export const LITTLETON_EMBED_URL =
  "https://vinplus.texnrewards.com/parts/littleton";

// Official root/inventory pages establish ownership, address and self-service.
// Coordinates are the saved ASYD physical business pin at /rows/122. The
// official pages do not publish coordinates. See the ingestion runbook.
export const LITTLETON_YARD = {
  source: "littleton",
  code: "littleton",
  name: "Littleton U-Pull-It",
  operator: "Littleton U-Pull-It",
  address: "8571 US Hwy. 85 N",
  city: "Littleton",
  state: "CO",
  postalCode: "80125",
  phone: "303-791-1380",
  email: "Rigo@upullits.com",
  lat: 39.48691,
  lng: -104.99796,
  websiteUrl: LITTLETON_INVENTORY_URL,
} as const satisfies Yard;
export type LittletonYard = typeof LITTLETON_YARD;
