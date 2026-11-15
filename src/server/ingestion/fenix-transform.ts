import type { FenixDonor } from "./fenix-donor";
import {
  FENIX_ORIGIN,
  FENIX_YARDS,
  type FenixYardCode,
} from "./fenix-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type FenixCanonicalVehicle = CanonicalVehicle & { source: "fenix" };
export function transformFenixDonor(
  donor: FenixDonor,
  code: FenixYardCode,
  id: string,
): FenixCanonicalVehicle {
  const yard = FENIX_YARDS[code];
  return {
    source: "fenix",
    vin: donor.vin,
    year: donor.year,
    make: donor.make,
    model: donor.model,
    color: null,
    stockNumber: donor.stockNumber,
    imageUrl: donor.photoUrl,
    availableDate: donor.availableDate,
    locationCode: code,
    locationName: yard.name,
    locationCity: yard.city,
    state: yard.state === "GA" ? "Georgia" : "New York",
    stateAbbr: yard.state,
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row: donor.position,
    space: null,
    detailsUrl: FENIX_ORIGIN + "/inventory/" + id,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
