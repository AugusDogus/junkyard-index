import type { Yard } from "~/lib/yard";

export const CARSANDPARTS_ORIGIN = "https://www.carsandpartshub.com";
export const CARSANDPARTS_COLLECTION =
  CARSANDPARTS_ORIGIN + "/collections/donor-cars";
export const CARSANDPARTS_CATALOG =
  CARSANDPARTS_COLLECTION + "/products.json?limit=250&page=1";
export const CARSANDPARTS_MINIMUM = 25;

// Named Google business marker, November 17, 2026. The native collection
// attributes every donor to Lumberton; its Recycar logo shares this address.
export const CARSANDPARTS_YARD = {
  source: "carsandparts",
  code: "lumberton",
  name: "CarsAndPartsHub",
  operator: "CarsAndPartsHub / Recycar",
  address: "1807 Route 38",
  city: "Lumberton",
  state: "NJ",
  postalCode: "08048",
  phone: "640-202-3856",
  email: null,
  websiteUrl: CARSANDPARTS_ORIGIN,
  lat: 39.9775847,
  lng: -74.7554689,
} as const satisfies Yard;
