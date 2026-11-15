import type { Yard } from "~/lib/yard";
export const MODERNMUSCLE_ORIGIN = "https://modernmusclesalvage.com";
export const MODERNMUSCLE_FEED =
  "https://hooks.modernmusclesalvage.com/api/storefront/vehicles";
export const MODERNMUSCLE_CONTACT =
  MODERNMUSCLE_ORIGIN + "/policies/contact-information";
// Yard-published contact address, Census Public_AR_Current matched 2026-11-15.
// Interpolated street position, not a rooftop.
export const MODERNMUSCLE_YARD = {
  source: "modernmuscle",
  code: "ray",
  name: "Modern Muscle Salvage",
  operator: "Modern Muscle Salvage",
  address: "15980 32 Mile Rd",
  city: "Ray",
  state: "MI",
  postalCode: "48096",
  phone: "586-473-6538",
  email: "store@modernmusclesalvage.com",
  websiteUrl: MODERNMUSCLE_ORIGIN,
  lat: 42.805030568101,
  lng: -82.97065485201,
} as const satisfies Yard;
