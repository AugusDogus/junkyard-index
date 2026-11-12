import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { PullsavewaRecord } from "./pullsavewa-record";
import type { PullsavewaYard } from "./pullsavewa-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type PullsavewaCanonicalVehicle = CanonicalVehicle & {
  source: "pullsavewa";
};
export type PullsavewaVehicleResult =
  | { status: "available"; vehicle: PullsavewaCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

function sourceDate(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[3]);
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  return year >= 1886 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day &&
    date.getTime() <= Date.now()
    ? date.toISOString()
    : null;
}

export function transformPullsavewaRecord(
  record: PullsavewaRecord,
  yard: PullsavewaYard,
): PullsavewaVehicleResult {
  const vin = inventoryVin(record.vin, record.year);
  const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !/[A-Z]/i.test(make) ||
    PullsavewaRecord.missingDescription(make) ||
    PullsavewaRecord.missingDescription(model) ||
    /hold|crush|sold|unavailable/i.test(record.row)
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "pullsavewa",
      vin,
      year,
      make,
      model,
      color: null,
      stockNumber: PullsavewaRecord.stockNumber(record.stock),
      imageUrl: PullsavewaRecord.photoUrl(record, yard),
      availableDate: sourceDate(record.date),
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      state: "Washington",
      stateAbbr: "WA",
      lat: yard.lat,
      lng: yard.lng,
      // Keep the literal native position, including SCRP. No status is inferred.
      row:
        /^[A-Z0-9 -]{1,32}$/i.test(record.row) &&
        !PullsavewaRecord.missingDescription(record.row)
          ? record.row
          : null,
      section: null,
      space: null,
      detailsUrl: record.detailsUrl,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
