import type { CanonicalVehicle } from "./types";
import { normalizeCanonicalColor, normalizeRegion } from "./normalization";
import {
  UPULLRPARTS_INVENTORY_URL,
  type UpullRPartsVehicle,
} from "./upullrparts-client";
import type { UpullRPartsYard } from "./upullrparts-yard-metadata";
import type { UpullRPartsMakeResolution } from "./upullrparts-makes";

export type UpullRPartsCanonicalVehicle = CanonicalVehicle & {
  source: "upullrparts";
};

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function availableDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    return null;
  return date.toISOString();
}

export type UsableUpullRPartsVehicle = UpullRPartsVehicle & {
  VIN: string;
  Year: number;
  Model: string;
};

export function isUsableUpullRPartsVehicle(
  record: UpullRPartsVehicle,
): record is UsableUpullRPartsVehicle {
  return (
    text(record.VIN) !== null &&
    text(record.Model) !== null &&
    typeof record.Year === "number" &&
    Number.isInteger(record.Year) &&
    record.Year > 0
  );
}

export function transformUpullRPartsVehicle(
  record: UpullRPartsVehicle,
  yard: UpullRPartsYard,
  make: UpullRPartsMakeResolution,
): UpullRPartsCanonicalVehicle | null {
  if (
    !isUsableUpullRPartsVehicle(record) ||
    yard.lat === null ||
    yard.lng === null
  )
    return null;
  return {
    vin: record.VIN.trim().toUpperCase(),
    source: "upullrparts",
    year: record.Year,
    make: make.status === "resolved" ? make.make : "Other",
    model: record.Model.trim(),
    color: normalizeCanonicalColor(record.Color ?? null),
    stockNumber: text(record.StockNumber),
    imageUrl: null,
    availableDate: availableDate(record.DateSetData),
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    ...normalizeRegion(yard.state),
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row:
      record.Row === null || record.Row === undefined
        ? null
        : text(String(record.Row)),
    space: null,
    detailsUrl: UPULLRPARTS_INVENTORY_URL,
    partsUrl: null,
    pricesUrl: "https://upullrparts.com/part-pricing/",
    engine: null,
    trim: null,
    transmission: null,
  };
}
