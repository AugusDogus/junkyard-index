import type { Yard } from "~/lib/yard";

export const SANDW_ORIGIN = "https://www.sandwauto.com";
export const SANDW_CATALOG = SANDW_ORIGIN + "/inventory-search";
export const SANDW_OWNER = SANDW_ORIGIN + "/locations/u-pull";
export const SANDW_API = SANDW_ORIGIN + "/api/inventory/vehicles";
export type SandwYard = Omit<Yard, "source"> & { source: "sandw" };

// Official U-Pull address, matched exactly by the Census address geocoder.
// Saved native pages and response: research/ga_fl_al/refill/sandw-*.body.
// This is the address-range point, not a claimed rooftop or parcel centroid.
export const SANDW_YARD = {
  source: "sandw",
  code: "lithonia-upull",
  name: "S&W U-Pull, U-Save",
  operator: "S&W Automotive Parts",
  address: "1826 Lithonia Industrial Blvd",
  city: "Lithonia",
  state: "GA",
  postalCode: "30058",
  phone: "770-482-9500",
  email: null,
  lat: 33.734542912905,
  lng: -84.115684003701,
  websiteUrl: SANDW_OWNER,
} as const satisfies SandwYard;

// Complete native report and closing capture: 624 unique field-complete donors.
export const SANDW_MINIMUM_UNIQUE_INVENTORY = 208;
