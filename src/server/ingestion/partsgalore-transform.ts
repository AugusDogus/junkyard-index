import { Yard } from "~/lib/yard";
import type { CanonicalVehicle } from "./types";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import { PARTSGALORE_INVENTORY_URL } from "./partsgalore-client";
import type { PartsGaloreRecord } from "./partsgalore-parser";
import type { PartsGaloreYard } from "./partsgalore-yard-metadata";

export type PartsGaloreCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "partsgalore";
};

export function isUsablePartsGaloreRecord(record: PartsGaloreRecord) {
  return Boolean(
    record.vin.trim() &&
    record.make.trim() &&
    record.model.trim() &&
    /^\d{4}$/.test(record.year) &&
    Number(record.year) > 0,
  );
}

function availableDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date.toISOString()
    : null;
}

export function transformPartsGaloreVehicle(
  record: PartsGaloreRecord,
  yard: PartsGaloreYard,
): PartsGaloreCanonicalVehicle | null {
  const { lat, lng } = Yard.coordinates(yard.lat, yard.lng);
  if (
    !isUsablePartsGaloreRecord(record) ||
    lat === null ||
    lng === null ||
    !yard.code.trim() ||
    !yard.name.trim() ||
    !yard.city.trim() ||
    !yard.state.trim()
  )
    return null;
  return {
    // Preserve pre-1981 provider identifiers, consistent with the other sources.
    vin: record.vin.trim().toUpperCase(),
    source: "partsgalore",
    year: Number(record.year),
    make: normalizeCanonicalMake(record.make),
    model: record.model.trim(),
    color: normalizeCanonicalColor(record.color),
    stockNumber: record.stockNumber.trim() || null,
    imageUrl: null,
    availableDate: availableDate(record.yardDate),
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    ...normalizeRegion(yard.state),
    lat,
    lng,
    section: null,
    row: record.row.trim() || null,
    space: null,
    detailsUrl: PARTSGALORE_INVENTORY_URL,
    partsUrl: null,
    pricesUrl: "https://parts-galore.com/parts-price-list/",
    engine: null,
    trim: null,
    transmission: null,
  };
}
