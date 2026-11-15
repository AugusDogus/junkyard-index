import type { Yard } from "~/lib/yard";
import { ALSHNED_ORIGIN } from "./alshned-parser";

export type AlshnedYard = Omit<Yard, "source"> & { source: "alshned" };
/** Native contact and all 43 details publish this Bristol address.
 * Coordinates: exact-address Census response 2026-11-15T05:53:10Z,
 * TIGER 134766358, right side, range 1299..1221. Street interpolation.
 */
export const ALSHNED_YARD = {
  source: "alshned",
  code: "bristol",
  name: "Alshned Auto Parts - Bristol",
  operator: "Alshned Auto Parts",
  address: "1231 Hayes Blvd suite b",
  city: "Bristol",
  state: "PA",
  postalCode: "19007",
  phone: "2678189509",
  email: null,
  websiteUrl: ALSHNED_ORIGIN,
  lat: 40.120438479353,
  lng: -74.856847323102,
} satisfies AlshnedYard;
