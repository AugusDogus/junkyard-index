import { normalizeCanonicalMake } from "./normalization";
import type { DentonVehicle } from "./denton-snapshot";
import { DENTON_YARD } from "./denton-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type DentonCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "denton";
};

/** Geography comes from the native operator, never VIN decoding or delivery area. */
export function transformDentonVehicle(
  vehicle: DentonVehicle,
): DentonCanonicalVehicle {
  return {
    source: "denton",
    vin: vehicle.vin,
    year: vehicle.year,
    make: normalizeCanonicalMake(vehicle.make),
    model: vehicle.model,
    color: vehicle.color,
    stockNumber: vehicle.stockNumber,
    imageUrl: vehicle.imageUrl,
    availableDate: vehicle.availableDate,
    locationCode: DENTON_YARD.code,
    locationName: DENTON_YARD.name,
    locationCity: DENTON_YARD.city,
    state: "Kansas",
    stateAbbr: DENTON_YARD.state,
    lat: DENTON_YARD.lat,
    lng: DENTON_YARD.lng,
    detailsUrl: vehicle.detailsUrl,
    row: vehicle.row,
    partsUrl: null,
    pricesUrl: null,
    section: null,
    space: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
