import type { Yard } from "~/lib/yard";

export const TRITOWN_ORIGIN = "https://tritownautosalvage.com";

// Native /cars/ supplies the address/phone and single-yard ownership statement.
// Coordinates match the saved public ASYD Mount Joy physical-yard identity.
export const TRITOWN_YARD = {
  source: "tritown",
  code: "mount-joy",
  name: "Tri Town Auto Salvage",
  operator: "Tri Town Auto Salvage",
  address: "865 Milton Grove Rd",
  city: "Mount Joy",
  state: "PA",
  postalCode: "17552",
  phone: "717-409-5279",
  email: null,
  lat: 40.12761,
  lng: -76.49085,
  websiteUrl: TRITOWN_ORIGIN + "/cars/",
} as const satisfies Yard;

export type TritownYard = typeof TRITOWN_YARD;
