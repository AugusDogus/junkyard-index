import type { Yard } from "~/lib/yard";
import type { OemLocation } from "./oem-transform";

// Census Public_AR_Current exact-address match on 2026-11-15 UTC.
// Street-range interpolation (499 through 401), not a rooftop/parcel point.
// Actual response: research/ga_fl_al/refill04/oem-census-geocode.body.
export const OEM_YARD = {
  source: "oem",
  code: "bluffton",
  name: "OEM Auto Recyclers",
  operator: "OEM Auto Recyclers",
  address: "481 Township Road 27",
  city: "Bluffton",
  state: "OH",
  postalCode: "45817",
  phone: "800-367-1901",
  email: null,
  lat: 40.848850053123,
  lng: -83.867668284281,
  websiteUrl: "https://oemautorecyclers.com/",
} as const satisfies Omit<Yard, "source"> & { source: "oem" };

export const OEM_LOCATION = {
  code: OEM_YARD.code,
  name: OEM_YARD.name,
  city: OEM_YARD.city,
  lat: OEM_YARD.lat,
  lng: OEM_YARD.lng,
} as const satisfies OemLocation;
