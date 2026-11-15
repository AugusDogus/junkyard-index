import type { Yard } from "~/lib/yard";

export const WEBERBROTHERS_ORIGIN = "https://www.weberbrothersauto.com";
export const WEBERBROTHERS_CATALOG =
  WEBERBROTHERS_ORIGIN + "/product-category/vehicles/?perpage=36";

// Native footer address matches ARA member 3553. Association coordinates have
// unspecified precision. Evidence: research/pa_md_wv/evidence/weber-geography.json.
export const WEBERBROTHERS_YARD = {
  source: "weberbrothers",
  code: "annville",
  name: "Weber Brothers Auto",
  operator: "Weber Brothers Auto, Inc.",
  address: "1325 East Main Street Unit 1",
  city: "Annville",
  state: "PA",
  postalCode: "17003-1612",
  phone: "800-222-2528",
  email: "info@weberbrothersauto.com",
  lat: 40.3456,
  lng: -76.5447,
  websiteUrl: WEBERBROTHERS_ORIGIN + "/",
} as const satisfies Omit<Yard, "source"> & { source: "weberbrothers" };
export type WeberbrothersYard = typeof WEBERBROTHERS_YARD;
