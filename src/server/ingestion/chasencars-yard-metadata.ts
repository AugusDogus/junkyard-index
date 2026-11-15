import type { Yard } from "~/lib/yard";

export const CHASENCARS_ORIGIN = "https://chasencarsauto.com";
export const CHASENCARS_OWNER = `${CHASENCARS_ORIGIN}/`;
export const CHASENCARS_YARD_URL = `${CHASENCARS_ORIGIN}/visit-our-yard/`;
export const CHASENCARS_CATALOG = `${CHASENCARS_ORIGIN}/inventory/`;
// Complete native 680-row report: 661 accepted, 19 rejects on 2026-11-15 UTC.
export const CHASENCARS_MINIMUM_INVENTORY = 550;
export const CHASENCARS_YARD = {
  source: "chasencars",
  code: "tulsa",
  name: "Chase N Cars",
  operator: "Chase N Cars Auto Parts",
  address: "6471 State Highway 66",
  city: "Tulsa",
  state: "OK",
  postalCode: "74131",
  phone: "918-584-8483",
  email: "office@chasencarsauto.com",
  // Native address shortlink's actual HTTP302 Location, !3d/!4d point fields.
  // The different @ coordinates describe the viewport and are not used.
  lat: 36.0699802,
  lng: -96.0607632,
  websiteUrl: CHASENCARS_OWNER,
} as const satisfies Omit<Yard, "source"> & { source: "chasencars" };
export type ChasencarsYard = typeof CHASENCARS_YARD;
