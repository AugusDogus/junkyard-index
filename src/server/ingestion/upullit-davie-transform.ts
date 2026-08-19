import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import {
  UPULLIT_DAVIE_ORIGIN,
  type UpullitDavieVehicle,
} from "./upullit-davie-client";
import type { CanonicalVehicle } from "./types";

function normalizeOptional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function transformUpullitDavieVehicle(
  vehicle: UpullitDavieVehicle,
): CanonicalVehicle | null {
  const vin = vehicle.vin.trim().toUpperCase();
  const model = vehicle.model.trim();
  if (!vin || !model || !Number.isInteger(vehicle.year) || vehicle.year <= 0) {
    return null;
  }

  const detailsUrl = new URL("/inventory", UPULLIT_DAVIE_ORIGIN);
  detailsUrl.searchParams.set("q", vin);

  return {
    vin,
    source: "upullitdavie",
    year: vehicle.year,
    make: normalizeCanonicalMake(vehicle.make),
    model,
    color: normalizeCanonicalColor(vehicle.color),
    stockNumber: normalizeOptional(vehicle.stockNumber),
    imageUrl: normalizeOptional(vehicle.imageUrl),
    availableDate: normalizeDate(vehicle.dateArrived),
    locationCode: "UPULLIT-DAVIE",
    locationName: "U Pull It Davie",
    locationCity: "Davie",
    state: "Florida",
    stateAbbr: "FL",
    lat: 26.0696,
    lng: -80.2437,
    section: null,
    row: normalizeOptional(vehicle.row),
    space: normalizeOptional(vehicle.space),
    detailsUrl: detailsUrl.toString(),
    partsUrl: `${UPULLIT_DAVIE_ORIGIN}/parts`,
    pricesUrl: `${UPULLIT_DAVIE_ORIGIN}/prices`,
    engine: normalizeOptional(vehicle.engine),
    trim: normalizeOptional(vehicle.trim),
    transmission: normalizeOptional(vehicle.transmission),
  };
}
