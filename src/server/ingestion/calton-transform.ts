import type { CaltonCandidate } from "./calton-record";
import type { CaltonCanonicalVehicle, CaltonLocation } from "./calton-contract";
import { normalizeCanonicalMake } from "./normalization";

export function transformCaltonCandidate(
  candidate: CaltonCandidate,
  location: CaltonLocation,
): CaltonCanonicalVehicle {
  return {
    source: "calton",
    vin: candidate.vin,
    year: candidate.year,
    make: normalizeCanonicalMake(candidate.make),
    model: candidate.model,
    stockNumber: candidate.stockNumber,
    imageUrl: candidate.imageUrl,
    availableDate: candidate.availableDate,
    color: candidate.color,
    row: candidate.row,
    locationCode: location.code,
    locationName: location.name,
    locationCity: location.city,
    state: "Maryland",
    stateAbbr: "MD",
    lat: location.lat,
    lng: location.lng,
    detailsUrl: candidate.detailsUrl,
    partsUrl: null,
    pricesUrl: null,
    section: null,
    space: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
