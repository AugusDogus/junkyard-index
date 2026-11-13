import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { BigtruckpageRecord } from "./bigtruckpage-parser";
import { BIGTRUCKPAGE_YARD } from "./bigtruckpage-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type BigtruckpageCanonicalVehicle = CanonicalVehicle & {
  source: "bigtruckpage";
};
export type BigtruckpageVehicleResult =
  | { status: "available"; vehicle: BigtruckpageCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
const key = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const missing = (value: string) =>
  !key(value) ||
  /^(?:other|unknown|none|null|undefined|na|n a|not available|unavailable|0+)$/.test(
    key(value),
  );
export const bigtruckpageRecordVin = (record: BigtruckpageRecord) =>
  inventoryVin(record.vin, record.year);

export function transformBigtruckpageRecord(
  record: BigtruckpageRecord,
): BigtruckpageVehicleResult {
  const vin = bigtruckpageRecordVin(record);
  const year = Number(record.year);
  const identity = key(record.year + " " + record.make + " " + record.model);
  const title = record.nativeTitle === null ? null : key(record.nativeTitle);
  if (
    !vin ||
    !/^\d{4}$/.test(record.year) ||
    year < 1886 ||
    year > 2100 ||
    missing(record.make) ||
    !/[a-z]/.test(key(record.make)) ||
    missing(record.model) ||
    key(record.label) !==
      key("Open donor truck: " + record.make + " " + record.model) ||
    (title !== null && title !== identity && !title.startsWith(identity + " "))
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "bigtruckpage",
      vin,
      year,
      make: normalizeCanonicalMake(record.make),
      model: record.model,
      imageUrl: record.imageUrl,
      stockNumber: null,
      color: null,
      availableDate: null,
      locationCode: BIGTRUCKPAGE_YARD.code,
      locationName: BIGTRUCKPAGE_YARD.name,
      locationCity: BIGTRUCKPAGE_YARD.city,
      state: "Missouri",
      stateAbbr: "MO",
      lat: BIGTRUCKPAGE_YARD.lat,
      lng: BIGTRUCKPAGE_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: record.url,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
