import { z } from "zod";
import type { CanonicalVehicle } from "./types";
import { normalizeCanonicalMake } from "./normalization";
import type { OemCandidate } from "./oem-record";

/** Root supplies a separately reviewed physical yard point before registration. */
export const OemLocationSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    city: z.string().min(1),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();
export type OemLocation = z.infer<typeof OemLocationSchema>;
export type OemCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "oem";
};
export function transformOemCandidate(
  candidate: OemCandidate,
  location: OemLocation,
): OemCanonicalVehicle {
  return {
    source: "oem",
    ...candidate,
    make: normalizeCanonicalMake(candidate.make),
    locationCode: location.code,
    locationName: location.name,
    locationCity: location.city,
    state: "Ohio",
    stateAbbr: "OH",
    lat: location.lat,
    lng: location.lng,
    partsUrl: null,
    pricesUrl: null,
    section: null,
    space: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
