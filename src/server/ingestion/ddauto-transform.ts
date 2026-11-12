import type { CanonicalVehicle } from "./types";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { DDAUTO_INVENTORY_URL, DDAUTO_YARD } from "./ddauto-yard-metadata";

export type DdautoStatus = "Parts" | "Premium Lot" | "NOT AVAILABLE" | "Killed";
export interface DdautoRecord {
  id: string;
  rowId: string;
  year: string;
  make: string;
  model: string;
  color: string;
  vin: string;
  status: DdautoStatus;
}
export type DdautoCanonicalVehicle = CanonicalVehicle & { source: "ddauto" };
export type DdautoTransformResult =
  | { status: "available"; vehicle: DdautoCanonicalVehicle }
  | { status: "excluded" }
  | { status: "incomplete"; vin: string | null };

export function transformDdautoRecord(
  record: DdautoRecord,
): DdautoTransformResult {
  if (record.status !== "Parts") return { status: "excluded" };
  const year = record.year.trim();
  const vin = inventoryVin(record.vin, year);
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  const unusable = /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i;
  if (
    !vin ||
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !make ||
    unusable.test(make) ||
    !model ||
    unusable.test(model)
  )
    return { status: "incomplete", vin };
  const color = record.color.trim();
  return {
    status: "available",
    vehicle: {
      source: "ddauto",
      vin,
      year: Number(year),
      make,
      model,
      color:
        unusable.test(color) || /^burn(?:t|ed)$/i.test(color)
          ? null
          : normalizeCanonicalColor(color),
      locationCode: DDAUTO_YARD.code,
      locationName: DDAUTO_YARD.name,
      locationCity: DDAUTO_YARD.city,
      state: "Utah",
      stateAbbr: "UT",
      lat: DDAUTO_YARD.lat,
      lng: DDAUTO_YARD.lng,
      detailsUrl: DDAUTO_INVENTORY_URL,
      // Glide row IDs are not stock numbers. Purchased/estimated dates are not set dates.
      stockNumber: null,
      imageUrl: null,
      availableDate: null,
      row: null,
      section: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
