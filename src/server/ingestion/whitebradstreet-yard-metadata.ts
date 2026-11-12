import type { Yard } from "~/lib/yard";
import type { TruckPartsCatalogConfig } from "./truck-parts-catalog";

export const WHITEBRADSTREET_ORIGIN = "https://white-bradstreet.com";
export const WHITEBRADSTREET_CATALOG = {
  origin: WHITEBRADSTREET_ORIGIN,
  listPath: "/trucks/",
  detailPath: "/truck-description/",
  photoAccount: "28272",
} as const satisfies TruckPartsCatalogConfig;

// Native contact footer and its linked Google business pin verified 2026-11-11.
// Coordinates are the !3d/!4d place markers, not the map viewport center.
export const WHITEBRADSTREET_YARD = {
  source: "whitebradstreet",
  code: "augusta",
  name: "White & Bradstreet",
  operator: "White & Bradstreet",
  address: "1020 Weeks Mills Rd",
  city: "Augusta",
  state: "ME",
  postalCode: "04330",
  phone: "207-622-2622",
  email: null,
  lat: 44.3404252,
  lng: -69.659884,
  websiteUrl: WHITEBRADSTREET_ORIGIN + "/trucks/?f-condition=nw",
} as const satisfies Yard;
export type WhitebradstreetYard = typeof WHITEBRADSTREET_YARD;
