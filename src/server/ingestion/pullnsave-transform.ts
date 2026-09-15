import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import {
  buildPullNSaveImageUrl,
  type PullNSaveVehicle,
} from "./pullnsave-client";
import type { PullNSaveYard } from "./pullnsave-config";
import { PULLNSAVE_INVENTORY_PAGE_URL } from "./pullnsave-config";
import type { CanonicalVehicle } from "./types";

export type PullNSaveCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "pullnsave";
};

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseReceivedDate(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function transformPullNSaveVehicle(
  record: PullNSaveVehicle,
  yard: PullNSaveYard,
): PullNSaveCanonicalVehicle | null {
  const vin = record.vin?.trim().toUpperCase() ?? "";
  if (!vin) return null;

  const year = record.year;
  if (
    year === null ||
    year === undefined ||
    !Number.isInteger(year) ||
    year <= 0
  ) {
    return null;
  }

  const model = optionalText(record.model);
  if (!model) return null;

  const stockNumber = optionalText(record.stockId);

  return {
    vin,
    source: "pullnsave",
    year,
    make: normalizeCanonicalMake(record.make ?? ""),
    model,
    color: normalizeCanonicalColor(record.color ?? null),
    stockNumber,
    imageUrl:
      stockNumber !== null ? buildPullNSaveImageUrl(stockNumber, 1) : null,
    availableDate: parseReceivedDate(record.rcvdDtTm),
    locationCode: yard.code,
    locationName: yard.locationName,
    locationCity: yard.city,
    state: yard.state,
    stateAbbr: yard.stateAbbr,
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row:
      record.yardRow !== null && record.yardRow !== undefined
        ? String(record.yardRow)
        : null,
    space: null,
    detailsUrl: PULLNSAVE_INVENTORY_PAGE_URL,
    partsUrl: null,
    pricesUrl: null,
    engine: optionalText(record.engineDesc),
    trim: null,
    transmission: optionalText(record.transmissionDesc),
  };
}
