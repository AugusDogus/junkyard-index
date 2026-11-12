import type { Yard } from "~/lib/yard";

export const ARMY_ORIGIN = "https://armysauto.com";
export const ARMY_INVENTORY_URL = ARMY_ORIGIN + "/self-service-inventory/";
// Native contact page's Google Maps iframe resolves to this exact business pin.
// Address, towing phone and website match. See the Army ingestion runbook.
export const ARMY_YARD = {
  source: "army",
  code: "lima",
  name: "Army's Auto Wrecking",
  operator: "Army's Auto Wrecking Inc.",
  address: "1510 St Johns Rd",
  city: "Lima",
  state: "OH",
  postalCode: "45804",
  phone: "567-371-1244",
  email: null,
  lat: 40.7159183,
  lng: -84.0939616,
  websiteUrl: ARMY_INVENTORY_URL,
} as const satisfies Yard;
