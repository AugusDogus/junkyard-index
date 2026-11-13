import type { Yard } from "~/lib/yard";

export const KODAK_ORIGIN = "https://kodakauto.co";
export const KODAK_HOME = KODAK_ORIGIN + "/";
export const KODAK_INVENTORY = KODAK_ORIGIN + "/pull-a-part";

// Exact-name/address/phone/domain ASYD AutoPartsStore JSON-LD business point.
// It is a third-party business point, not a native pin or a city centroid.
// Evidence: parallel-ma-ct-ri/kodak-saved-preflight01/report.json.
export const KODAK_YARD = {
  source: "kodak",
  code: "strawberry-plains",
  name: "Kodak Auto Inc / American Auto Sales & Parts",
  operator: "Kodak Auto Inc",
  address: "647 Asheville Hwy",
  city: "Strawberry Plains",
  state: "TN",
  postalCode: "37871",
  phone: "865-401-2898",
  email: null,
  lat: 36.0198225,
  lng: -83.6432872,
  websiteUrl: KODAK_HOME,
} as const satisfies Omit<Yard, "source"> & { source: "kodak" };
export type KodakYard = typeof KODAK_YARD;
