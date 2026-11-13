import type { Yard } from "~/lib/yard";

export const ROHNER_ORIGIN = "https://rohnersautoparts.com";
export const ROHNER_CATALOG =
  ROHNER_ORIGIN + "/shop/?product-categories=vehicles";

// Native identity: parallel-mn-ia-ne-sd/rohner-location09/location-parsed.json.
// Named business point: parallel-ak-hi/rohner-physical266-review38/
// maps-addendum-report.json. The native location page warns about GPS errors.
export const ROHNER_YARD = {
  source: "rohner",
  code: "willmar",
  name: "Rohner's Auto Parts, Inc.",
  operator: "Rohner's Auto Parts, Inc.",
  address: "1800 County Road 27 NW",
  city: "Willmar",
  state: "MN",
  postalCode: "56201",
  phone: "320-235-4602",
  email: "info@rohnersautoparts.com",
  lat: 45.2116768,
  lng: -95.06669989999999,
  websiteUrl: ROHNER_ORIGIN + "/",
} as const satisfies Omit<Yard, "source"> & { source: "rohner" };
export type RohnerYard = typeof ROHNER_YARD;
