import { API_ENDPOINTS } from "~/lib/constants";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import type {
  PullapartLocation,
  PullapartVehicle,
  PullapartZipGeo,
} from "./pullapart-client";
import type { CanonicalVehicle } from "./types";

function readExtendedInfoField(
  extendedInfo: unknown,
  keys: ReadonlyArray<string>,
): string | null {
  if (!extendedInfo || typeof extendedInfo !== "object") {
    return null;
  }

  const record = extendedInfo as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function buildDetailsUrl(
  location: PullapartLocation,
  vehicle: PullapartVehicle,
): string {
  const baseHost =
    location.siteTypeID === 5
      ? API_ENDPOINTS.UPULLANDPAY_WEB
      : API_ENDPOINTS.PULLAPART_WEB;
  const query = new URLSearchParams({
    LocationID: String(vehicle.locID),
    LocationPage: "True",
    Locations: String(vehicle.locID),
    MakeID: String(vehicle.makeID),
    Models: String(vehicle.modelID),
    Years: String(vehicle.modelYear),
  });
  return `${baseHost}/inventory/search/?${query.toString()}#results`;
}

export function transformPullapartVehicle(
  vehicle: PullapartVehicle,
  location: PullapartLocation | undefined,
  geo: PullapartZipGeo | undefined,
): CanonicalVehicle | null {
  if (!location) return null;
  if (!geo) return null;
  if (!vehicle.vin?.trim()) return null;
  if (!vehicle.makeName?.trim() || !vehicle.modelName?.trim()) return null;

  const region = normalizeRegion(location.stateName, null);

  return {
    vin: vehicle.vin.trim(),
    source: "pullapart",
    year: vehicle.modelYear,
    make: normalizeCanonicalMake(vehicle.makeName),
    model: vehicle.modelName.trim(),
    color: normalizeCanonicalColor(
      readExtendedInfoField(vehicle.extendedInfo, ["color", "exteriorColor"]),
    ),
    stockNumber: String(vehicle.ticketID),
    imageUrl: null,
    availableDate: vehicle.dateYardOn || null,
    locationCode: String(location.locationID),
    locationName: location.locationName.trim(),
    locationCity: location.cityName.trim() || "Unknown",
    state: region.state,
    stateAbbr: region.stateAbbr,
    lat: geo.lat,
    lng: geo.lng,
    section: null,
    row:
      typeof vehicle.row === "number"
        ? String(vehicle.row)
        : vehicle.row?.toString().trim() || null,
    space: null,
    detailsUrl: buildDetailsUrl(location, vehicle),
    partsUrl: null,
    pricesUrl: null,
    engine: readExtendedInfoField(vehicle.extendedInfo, [
      "engine",
      "engineDescription",
    ]),
    trim: readExtendedInfoField(vehicle.extendedInfo, ["trim"]),
    transmission: readExtendedInfoField(vehicle.extendedInfo, [
      "transmission",
      "transmissionDescription",
    ]),
  };
}
