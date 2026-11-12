import type { Yard } from "~/lib/yard";

export const RUSTYHOOK_ORIGIN = "http://salvage.rustyhooktowing.com";
export const RUSTYHOOK_CATALOG = RUSTYHOOK_ORIGIN + "/";

// ASYD's exact Pittsburgh business slug binds the native address to its map
// point, not a viewport or city centroid. Third-party precision is unsurveyed.
// Geography gate: parallel-ky-tn-ar/rustyhook-geography-review/geography-gate.json.
// Header ext. 2 and contact Extension 3 conflict, so retain only the base phone.
export const RUSTYHOOK_YARD = {
  source: "rustyhook",
  code: "pittsburgh",
  name: "Rusty Hook Auto Salvage Pittsburgh",
  operator: "Rusty Hook Auto Salvage",
  address: "3015 Mt. Troy Rd.",
  city: "Pittsburgh",
  state: "PA",
  postalCode: "15212",
  phone: "412-657-9522",
  email: null,
  lat: 40.47834,
  lng: -79.98681,
  websiteUrl: RUSTYHOOK_CATALOG,
} as const satisfies Omit<Yard, "source"> & { source: "rustyhook" };
export type RustyhookYard = typeof RUSTYHOOK_YARD;
