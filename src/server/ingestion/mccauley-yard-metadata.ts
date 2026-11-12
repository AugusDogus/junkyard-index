import type { Yard } from "~/lib/yard";

export const MCCAULEY_INDEX = "https://www.mccauleysauto.com/parts-vehicles";
export const MCCAULEY_CURRENT =
  "https://www.mccauleysauto.com/pick-a-part-list-of-parts-vehicles";
export const MCCAULEY_DETAIL_ORIGIN = "http://mccauleysautocom.fatcow.com";

// Native lists establish the physical yard. Coordinates are the separately
// retained ASYD mccauleys-auto-new-bethlehem-pa map row, not a native map pin.
export const MCCAULEY_YARD = {
  source: "mccauley",
  code: "new-bethlehem",
  name: "McCauley's Auto LLC",
  operator: "McCauley's Auto LLC",
  address: "5156 Rt 66",
  city: "New Bethlehem",
  state: "PA",
  postalCode: "16242",
  phone: "814-297-0163",
  email: "McCauleysAutoLLC@gmail.com",
  lat: 41.07134,
  lng: -79.31888,
  websiteUrl: MCCAULEY_INDEX,
} as const satisfies Yard;
export type MccauleyYard = typeof MCCAULEY_YARD;

export function verifyMccauleyYard(plain: string): void {
  if (
    !plain.includes("5156 Rt 66") ||
    !plain.includes("New Bethlehem, PA 16242, US") ||
    !plain.includes("814-297-0163") ||
    !plain.includes("Junkyard, Salvage Yard")
  )
    throw new Error(
      "McCauley native physical yard identity changed or is missing",
    );
}
