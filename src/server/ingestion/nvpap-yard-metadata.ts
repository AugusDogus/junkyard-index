import type { Yard } from "~/lib/yard";
import type { NvpapYardCode } from "./nvpap-cursor";

export const NVPAP_ORIGIN = "https://nvpap.com";
export type NvpapYard = Yard & { source: "nvpap"; code: NvpapYardCode };
// Official contact addresses and phones, verified 2026-11-11. Coordinates are
// the named business pins returned by the site's Google map destinations,
// not their viewport centers. See docs/runbooks/nvpap-ingestion.md.
export const NVPAP_YARDS = {
  "1074": {
    name: "Nevada Pic-A-Part North Las Vegas",
    city: "North Las Vegas",
    address: "5100 N. Lamb Blvd. #5",
    postalCode: "89115",
    phone: "+1-702-643-1776",
    lat: 36.2527229,
    lng: -115.0794377,
    next: "1075",
  },
  "1075": {
    name: "Nevada Pic-A-Part Henderson",
    city: "Henderson",
    address: "110 W. Rolly Str.",
    postalCode: "89011",
    phone: "+1-702-565-1414",
    lat: 36.0565206,
    lng: -115.0027763,
    next: null,
  },
} as const satisfies Record<
  NvpapYardCode,
  {
    name: string;
    city: string;
    address: string;
    postalCode: string;
    phone: string;
    lat: number;
    lng: number;
    next: NvpapYardCode | null;
  }
>;

export function nvpapInventoryUrl(code: NvpapYardCode): string {
  // This restores the yard's search form. VehicleDestination supplies the
  // manual-search action because all-model/all-year links do not load results.
  // The source calls atob on the raw URL substring. Percent-encoding padding
  // breaks restoration. Native set-date "-2" means all dates; "any" is invalid.
  const payload = Buffer.from(
    JSON.stringify([Number(code), 1, "-2", -1, -1, -1]),
  ).toString("base64");
  return NVPAP_ORIGIN + "/part-interchange.html?p=" + payload;
}
