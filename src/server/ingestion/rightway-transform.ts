import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { RightwayRecord } from "./rightway-parser";
import { RIGHTWAY_YARD } from "./rightway-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type RightwayCanonicalVehicle = CanonicalVehicle & {
  source: "rightway";
};
export type RightwayVehicleResult =
  | { status: "available"; vehicle: RightwayCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

export function parseRightwayStockNumber(raw: string): string | null {
  return /^\d{1,2}-\d{1,3}-\d{2}$/.test(raw) ? raw : null;
}
function dateAdded(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[3]);
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  return year >= 1886 &&
    year <= 2100 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
    ? date.toISOString()
    : null;
}
export function transformRightwayRecord(
  record: RightwayRecord,
  pricesUrl: string | null = null,
): RightwayVehicleResult {
  const vin = inventoryVin(record.vin, record.year);
  const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  const unknown = /^(?:other|unknown|none|n\/a|-)$/i;
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !make ||
    unknown.test(make) ||
    !model ||
    unknown.test(model)
  )
    return { status: "incomplete", vin };
  const color =
    /^[a-z]+(?:[ /-][a-z]+)*$/i.test(record.color) &&
    !unknown.test(record.color)
      ? normalizeCanonicalColor(record.color)
      : null;
  return {
    status: "available",
    vehicle: {
      source: "rightway",
      vin,
      year,
      make,
      model,
      color,
      stockNumber: parseRightwayStockNumber(record.stock),
      availableDate: dateAdded(record.dateAdded),
      imageUrl: null,
      detailsUrl: record.nativeUrl,
      pricesUrl,
      partsUrl: null,
      locationCode: RIGHTWAY_YARD.code,
      locationName: RIGHTWAY_YARD.name,
      locationCity: RIGHTWAY_YARD.city,
      state: "Tennessee",
      stateAbbr: "TN",
      lat: RIGHTWAY_YARD.lat,
      lng: RIGHTWAY_YARD.lng,
      section: null,
      row: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
