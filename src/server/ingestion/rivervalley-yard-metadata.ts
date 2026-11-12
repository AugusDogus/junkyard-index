import type { Yard } from "~/lib/yard";
import type { TruckPartsCatalogConfig } from "./truck-parts-catalog";

export const RIVERVALLEY_ORIGIN = "https://rivervalleytruckparts.com";
export const RIVERVALLEY_CATALOG = {
  origin: RIVERVALLEY_ORIGIN,
  listPath: "/new-arrivals/",
  detailPath: "/truck-description/",
  photoAccount: "24174",
} as const satisfies TruckPartsCatalogConfig;

// Native Salvage listing/detail supplies ownership. The source-linked Google
// business pin supplies !3d/!4d coordinates, not the map viewport center.
export const RIVERVALLEY_YARD = {
  source: "rivervalley",
  code: "kankakee",
  name: "River Valley Truck Parts",
  operator: "River Valley Truck Parts",
  address: "288 W South Tec Drive",
  city: "Kankakee",
  state: "IL",
  postalCode: "60901",
  phone: "815-936-0406",
  email: null,
  lat: 41.0852855,
  lng: -87.8751744,
  websiteUrl: RIVERVALLEY_ORIGIN + "/new-arrivals/?f-condition=nw",
} as const satisfies Yard;

export type RivervalleyYard = typeof RIVERVALLEY_YARD;
