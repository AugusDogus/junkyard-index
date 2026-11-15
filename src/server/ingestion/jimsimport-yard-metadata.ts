import type { Yard } from "~/lib/yard";

export const JIMSIMPORT_ORIGIN = "https://jimsimport.com";
export const JIMSIMPORT_CATALOG = JIMSIMPORT_ORIGIN + "/used-parts/makes";
export const JIMSIMPORT_OWNER = JIMSIMPORT_ORIGIN + "/contact/";
export const JIMSIMPORT_MAX_BYTES = 2 * 1024 * 1024;
export type JimsimportYard = Omit<Yard, "source"> & { source: "jimsimport" };
// Exact native address independently matched by Census on 2026-11-15.
// Coordinates interpolate the 3600..3698 street range, not a rooftop.
export const JIMSIMPORT_YARD = {
  source: "jimsimport",
  code: "sebring-import",
  name: "Jim's Import Auto Salvage",
  operator: "Jim's Import Auto Salvage / Jim's Auto Salvage",
  address: "3636 DeSoto Rd",
  city: "Sebring",
  state: "FL",
  postalCode: "33870",
  phone: "863-471-1177",
  email: "info@jimsimport.com",
  websiteUrl: JIMSIMPORT_ORIGIN,
  lat: 27.471305405823,
  lng: -81.429188442867,
} as const satisfies JimsimportYard;
