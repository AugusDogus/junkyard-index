import type { Yard } from "~/lib/yard";

export type PartsGaloreYard = Yard & { source: "partsgalore" };

// Verified 2026-09-15: https://parts-galore.com/contact/ supplies address/phone
// and a Google Maps embed for 0x8824d124792fbb4f:0xb02a1194b62a4d48.
// Its embed response identifies Parts Galore at [42.448375,-83.00895]. These
// are the place pin coordinates, not the embed URL's offset viewport center.
// Only this yard is currently listed. Historical three-yard claims are stale.
export const PARTSGALORE_YARD: PartsGaloreYard = {
  source: "partsgalore",
  code: "PG-DETROIT",
  name: "Parts Galore - Detroit",
  operator: "Parts Galore",
  address: "11360 E 8 Mile Rd",
  city: "Detroit",
  state: "MI",
  postalCode: "48205",
  lat: 42.448375,
  lng: -83.00895,
  websiteUrl: "https://parts-galore.com/",
  phone: "313-245-2944",
  email: null,
};
