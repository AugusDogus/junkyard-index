import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { IdipullRecord } from "./idipull-parser";
import type { CanonicalVehicle } from "./types";
import { IDIPULL_INVENTORY_URL, IDIPULL_YARD } from "./idipull-yard-metadata";

export type IdipullCanonicalVehicle = CanonicalVehicle & { source: "idipull" };
export type IdipullVehicleResult =
  | { status: "available"; vehicle: IdipullCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

export function transformIdipullRecord(
  record: IdipullRecord,
): IdipullVehicleResult {
  const vin = inventoryVin(record.vin, record.year);
  const year = Number(record.year);
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  const unknown = /^(?:unknown|other|n\/?a|none|null|undefined|[-?]+)$/i;
  if (
    !vin ||
    !/^\d{4}$/.test(record.year) ||
    year < 1886 ||
    year > 2100 ||
    !make ||
    unknown.test(make) ||
    !model ||
    unknown.test(model)
  ) {
    return { status: "incomplete", vin };
  }
  return {
    status: "available",
    vehicle: {
      source: "idipull",
      vin,
      year,
      make,
      model,
      color:
        /^[a-z]+(?:[ /-][a-z]+)*$/i.test(record.color) &&
        !unknown.test(record.color)
          ? normalizeCanonicalColor(record.color)
          : null,
      stockNumber: /^STK\d{6}$/.test(record.stockNumber)
        ? record.stockNumber
        : null,
      row: /^\d{1,4}$/.test(record.row) ? record.row : null,
      // The source publishes MM/DD/YY only. Keep the raw value in the parser;
      // do not invent a century or timezone for a nullable canonical date.
      availableDate: null,
      imageUrl: null,
      detailsUrl: IDIPULL_INVENTORY_URL,
      partsUrl: null,
      pricesUrl: null,
      locationCode: IDIPULL_YARD.code,
      locationName: IDIPULL_YARD.name,
      locationCity: IDIPULL_YARD.city,
      state: "Idaho",
      stateAbbr: "ID",
      lat: IDIPULL_YARD.lat,
      lng: IDIPULL_YARD.lng,
      section: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
