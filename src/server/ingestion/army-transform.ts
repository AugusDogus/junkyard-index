import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { ArmyRecord } from "./army-parser";
import { ARMY_INVENTORY_URL, ARMY_YARD } from "./army-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type ArmyCanonicalVehicle = CanonicalVehicle & { source: "army" };
export type ArmyVehicleResult =
  | { status: "available"; vehicle: ArmyCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

function missingDescription(value: string): boolean {
  return (
    /^(?:|other|unknown|none|null|na|0+)$/.test(
      value.toLowerCase().replace(/[\s/_.-]+/g, ""),
    ) || !/[A-Z0-9]/i.test(value)
  );
}

export function parseArmyStockNumber(raw: string): string | null {
  return /^(?!0+$)\d{1,30}$/.test(raw) ? raw : null;
}

export function transformArmyRecord(record: ArmyRecord): ArmyVehicleResult {
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
  return {
    status: "available",
    vehicle: {
      source: "army",
      vin,
      year,
      make,
      model,
      color: missingDescription(record.color)
        ? null
        : normalizeCanonicalColor(record.color),
      stockNumber: parseArmyStockNumber(record.stock),
      imageUrl: null,
      availableDate: null,
      locationCode: ARMY_YARD.code,
      locationName: ARMY_YARD.name,
      locationCity: ARMY_YARD.city,
      state: "Ohio",
      stateAbbr: "OH",
      lat: ARMY_YARD.lat,
      lng: ARMY_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: ARMY_INVENTORY_URL,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
