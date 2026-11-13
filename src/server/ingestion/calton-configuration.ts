import type { Yard } from "~/lib/yard";
import type { CaltonContract } from "./calton-contract";

// Native MM28 ownership/contact and KY40 independently matched business point.
// Keep the native footer's "Eldridge" typo in evidence, use the verified city here.
export const CALTON_YARD = {
  source: "calton",
  code: "elkridge",
  name: "Calton Auto Parts Recyclers",
  operator: "Calton Auto Parts Recyclers",
  address: "7491 Washington Blvd",
  city: "Elkridge",
  state: "MD",
  postalCode: "21075",
  phone: "410-799-1320",
  email: null,
  lat: 39.1794853,
  lng: -76.7697906,
  websiteUrl: "https://caltonautoparts.com/",
} as const satisfies Yard;

export const CALTON_CONTRACT = {
  location: {
    code: CALTON_YARD.code,
    name: CALTON_YARD.name,
    city: CALTON_YARD.city,
    lat: CALTON_YARD.lat,
    lng: CALTON_YARD.lng,
  },
  // Complete 630-model native graph and arrivals union, minimum checked before emission.
  minimumUniqueInventory: 11_000,
} satisfies CaltonContract;
