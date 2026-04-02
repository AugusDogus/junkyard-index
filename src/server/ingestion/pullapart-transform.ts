import { API_ENDPOINTS } from "~/lib/constants";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import type {
  PullapartLocation,
  PullapartVehicle,
  PullapartVehicleExtendedInfo,
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

function readDetailString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDetailNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatPullapartEngine(
  detail: PullapartVehicleExtendedInfo | null,
  extendedInfo: unknown,
): string | null {
  if (detail) {
    const size = readDetailNumber(detail.engineSize);
    const block = readDetailString(detail.engineBlock);
    const cylinders = readDetailNumber(detail.engineCylinders);
    const aspiration = readDetailString(detail.engineAspiration);

    const family =
      block && cylinders !== null
        ? `${block}${Math.trunc(cylinders)}`
        : block ?? (cylinders !== null ? String(Math.trunc(cylinders)) : null);
    const detailParts = [
      size !== null ? `${size}L` : null,
      family,
      aspiration && aspiration !== "N/A" ? aspiration : null,
    ].filter((part): part is string => Boolean(part));

    if (detailParts.length > 0) {
      return detailParts.join(" ");
    }
  }

  return readExtendedInfoField(extendedInfo, ["engine", "engineDescription"]);
}

function formatPullapartTransmission(
  detail: PullapartVehicleExtendedInfo | null,
  extendedInfo: unknown,
): string | null {
  if (detail) {
    const speeds = readDetailNumber(detail.transSpeeds);
    const transType = readDetailString(detail.transType);
    const transTypeLabel =
      transType === "A"
        ? "Automatic"
        : transType === "M"
          ? "Manual"
          : transType === "CVT"
            ? "CVT"
            : transType;

    if (speeds !== null && transTypeLabel) {
      return `${Math.trunc(speeds)}-Speed ${transTypeLabel}`;
    }

    if (transTypeLabel) {
      return transTypeLabel;
    }
  }

  return readExtendedInfoField(extendedInfo, [
    "transmission",
    "transmissionDescription",
  ]);
}

function normalizePullapartAvailableDate(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (dateOnlyMatch?.[1]) {
    const isoCandidate = `${dateOnlyMatch[1]}T00:00:00.000Z`;
    const parsed = new Date(isoCandidate);
    return Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== dateOnlyMatch[1]
      ? null
      : parsed.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function transformPullapartVehicle(
  vehicle: PullapartVehicle,
  location: PullapartLocation | undefined,
  geo: PullapartZipGeo | undefined,
  options?: {
    detail?: PullapartVehicleExtendedInfo | null;
    imageUrl?: string | null;
  },
): CanonicalVehicle | null {
  if (!location) return null;
  if (!geo) return null;
  if (!vehicle.vin?.trim()) return null;
  if (!vehicle.makeName?.trim() || !vehicle.modelName?.trim()) return null;

  const region = normalizeRegion(location.stateName, null);
  const detail = options?.detail ?? null;
  const locationName = location.locationName.trim() || vehicle.locName.trim();
  const locationCity = location.cityName.trim() || "Unknown";

  return {
    vin: vehicle.vin.trim(),
    source: "pullapart",
    year: vehicle.modelYear,
    make: normalizeCanonicalMake(vehicle.makeName),
    model: vehicle.modelName.trim(),
    color: normalizeCanonicalColor(
      readDetailString(detail?.color) ??
        readExtendedInfoField(vehicle.extendedInfo, ["color", "exteriorColor"]),
    ),
    stockNumber: String(vehicle.ticketID),
    imageUrl: options?.imageUrl ?? null,
    availableDate: normalizePullapartAvailableDate(vehicle.dateYardOn),
    locationCode: String(location.locationID),
    locationName,
    locationCity,
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
    engine: formatPullapartEngine(detail, vehicle.extendedInfo),
    trim:
      readDetailString(detail?.trim) ??
      readExtendedInfoField(vehicle.extendedInfo, ["trim"]),
    transmission: formatPullapartTransmission(detail, vehicle.extendedInfo),
  };
}
