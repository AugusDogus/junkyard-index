import type { Yard } from "~/lib/yard";

export const MICHIGANTRUCK_ORIGIN = "https://michigantruck.com";
export const MICHIGANTRUCK_CATALOG = MICHIGANTRUCK_ORIGIN + "/trucks/";
export const MICHIGANTRUCK_SALVAGE = MICHIGANTRUCK_CATALOG + "?f-condition=nw";
// ITPA CompanyID 84 publishes this exact business marker. The native Google
// embed viewport is separate evidence and is not used as the business point.
export const MICHIGANTRUCK_YARD = {
  source: "michigantruck",
  code: "westland",
  name: "Michigan Truck Parts",
  operator: "Michigan Truck Parts",
  address: "38658 Ford Rd",
  city: "Westland",
  state: "MI",
  postalCode: "48185",
  phone: "734-722-3800",
  email: null,
  lat: 42.3249,
  lng: -83.4221,
  websiteUrl: MICHIGANTRUCK_ORIGIN + "/",
} as const satisfies Yard;
export type MichigantruckYard = typeof MICHIGANTRUCK_YARD;
