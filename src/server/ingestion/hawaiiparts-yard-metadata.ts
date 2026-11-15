import type { Yard } from "~/lib/yard";
export const HAWAIIPARTS_ORIGIN = "https://aloha.parts";
export const HAWAIIPARTS_CATALOG = HAWAIIPARTS_ORIGIN + "/pages/yard";
// Yard-published address, Census Public_AR_Current matched 2026-11-15.
// Interpolated street position, not a rooftop. Tampa is a parts warehouse only.
export const HAWAIIPARTS_YARD = {
  source: "hawaiiparts",
  code: "kapolei",
  name: "Hawaii Parts",
  operator: "AutoJapan LLC",
  address: "91-222 Olai St",
  city: "Kapolei",
  state: "HI",
  postalCode: "96707",
  phone: "808-788-7424",
  email: "anton@usa.parts",
  websiteUrl: HAWAIIPARTS_ORIGIN,
  lat: 21.299403051719,
  lng: -158.099812773634,
} as const satisfies Yard;
