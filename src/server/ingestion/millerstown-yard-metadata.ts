import type { Yard } from "~/lib/yard";

export const MILLERSTOWN_ORIGIN = "http://picapartyard.com";
export const MILLERSTOWN_ROOT_URL = MILLERSTOWN_ORIGIN + "/";
export const MILLERSTOWN_INVENTORY_URL =
  MILLERSTOWN_ORIGIN + "/vehicles-on-premises/";
// ARA member 3298's exact-address business point, independently verified against
// the native address. Third-party coordinates, not a native pin or city centroid.
export const MILLERSTOWN_YARD = {
  source: "millerstown",
  code: "tarentum",
  name: "Millerstown Pic-A-Part",
  operator: "Millerstown Pic-A-Part",
  address: "3148 Lardintown Road",
  city: "Tarentum",
  state: "PA",
  postalCode: "15084",
  phone: "724-224-4777",
  email: null,
  lat: 40.6712657,
  lng: -79.7982583,
  websiteUrl: MILLERSTOWN_ROOT_URL,
} as const satisfies Omit<Yard, "source"> & { source: "millerstown" };
