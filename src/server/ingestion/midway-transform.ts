import { midwayVehiclePhoto } from "./vehicle-photo";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { MidwayRecord } from "./midway-parser";
import {
  MIDWAY_YARDS,
  midwayInventoryUrl,
  type MidwayYardCode,
} from "./midway-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type MidwayCanonicalVehicle = CanonicalVehicle & { source: "midway" };
export type MidwayVehicleResult =
  | { status: "available"; vehicle: MidwayCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

function missingDescription(value: string): boolean {
  return (
    /^(?:|other|unknown|none|null|na|0+)$/.test(
      value.toLowerCase().replace(/[\s/_.-]+/g, ""),
    ) || !/[A-Z0-9]/i.test(value)
  );
}

export function parseMidwayStockNumber(raw: string): string | null {
  const stock = raw.trim();
  return /^(?!0+$)[A-Z0-9][A-Z0-9-]{1,39}$/i.test(stock) &&
    !missingDescription(stock)
    ? stock
    : null;
}

function sourceDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? date.toISOString()
    : null;
}

export function transformMidwayRecord(
  record: MidwayRecord,
  code: MidwayYardCode,
): MidwayVehicleResult {
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
    missingDescription(make) ||
    missingDescription(model)
  )
    return { status: "incomplete", vin };
  const yard = MIDWAY_YARDS[code];
  return {
    status: "available",
    vehicle: {
      source: "midway",
      vin,
      year,
      make,
      model,
      color: null,
      stockNumber: parseMidwayStockNumber(record.stock),
      imageUrl: midwayVehiclePhoto(record.imageUrl),
      availableDate: sourceDate(record.arrived),
      locationCode: code,
      locationName: yard.name,
      locationCity: yard.city,
      state:
        code === "MO38" ? "Kansas" : code === "MO09" ? "Missouri" : "Oklahoma",
      stateAbbr: yard.state,
      lat: yard.lat,
      lng: yard.lng,
      section: null,
      row:
        /^(?!0$)[A-Z0-9][A-Z0-9 -]{0,39}$/i.test(record.row) &&
        !missingDescription(record.row)
          ? record.row
          : null,
      space: null,
      detailsUrl: midwayInventoryUrl(code),
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
