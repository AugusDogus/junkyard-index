import type { Yard } from "~/lib/yard";
import { COUTU_HOME } from "./coutu-protocol";

// Native homepage/footer address, domain and phone match this named Google
// business point (place_id ChIJ8x0xA09j5okRZ1O_HW2ewV4). Accuracy is unstated.
export const COUTU_YARD = {
  source: "coutu",
  code: "willimantic",
  name: "Truck Country",
  operator: "Truck Country",
  address: "1535 W Main St",
  city: "Willimantic",
  state: "CT",
  postalCode: "06226",
  phone: "860-423-6004",
  email: null,
  lat: 41.7189312,
  lng: -72.2349279,
  websiteUrl: COUTU_HOME,
} as const satisfies Omit<Yard, "source"> & { source: "coutu" };
export type CoutuYard = typeof COUTU_YARD;
