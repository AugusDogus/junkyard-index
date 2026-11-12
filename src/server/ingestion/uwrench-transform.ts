import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { vinplusOptionalText, vinplusSourceDate } from "./vinplus-protocol";
import type { CanonicalVehicle } from "./types";
import type { UwrenchNativeRow, UwrenchRecord } from "./uwrench-parser";
import { UWRENCH_INVENTORY_URL, UWRENCH_YARD } from "./uwrench-yard-metadata";

export type UwrenchCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "uwrench";
};
export type UwrenchDisposition =
  | { status: "available"; vehicle: UwrenchCanonicalVehicle }
  | {
      status: "rejected";
      stock: string;
      vin: string | null;
      reason:
        | "identity-unavailable"
        | "invalid-identity"
        | "invalid-native-ymm"
        | "active-scope-unproven";
    };
export function uwrenchRecordVin(record: UwrenchRecord): string | null {
  return typeof record.vin === "string"
    ? inventoryVin(record.vin, String(record.year))
    : null;
}
/** Exact stable-source comparison. The checkpoint separately binds the full
 * stored payload, including clock-derived daysInYard, without this projection.
 */
export function uwrenchStableRecord(record: UwrenchRecord) {
  return {
    stock: record.stock,
    year: record.year,
    vin: record.vin ?? null,
    make: record.make ?? null,
    model: record.model ?? null,
    color: record.color ?? null,
    vehicleRow: record.vehicleRow ?? null,
    dateAdded: record.dateAdded ?? null,
    yardLocation: record.yardLocation,
    sourceSystem: record.sourceSystem,
    demo_offset_seconds: record.demo_offset_seconds ?? null,
    damage_condition: record.damage_condition ?? null,
    engine: record.engine ?? null,
    fuel_type: record.fuel_type ?? null,
    transmission: record.transmission ?? null,
    imageUrl: record.imageUrl ?? null,
    imageUrls: record.imageUrls ?? null,
  };
}
export function transformUwrenchExtra(
  record: UwrenchRecord,
): UwrenchDisposition {
  return {
    status: "rejected",
    stock: record.stock,
    vin: uwrenchRecordVin(record),
    reason: "active-scope-unproven",
  };
}
export function transformUwrenchRow(
  row: UwrenchNativeRow,
  record: UwrenchRecord | undefined,
): UwrenchDisposition {
  if (!record)
    return {
      status: "rejected",
      stock: row.stock,
      vin: null,
      reason: "identity-unavailable",
    };
  const vin = uwrenchRecordVin(record);
  const nativeMake = vinplusOptionalText(row.make);
  const model = vinplusOptionalText(row.model);
  const make = normalizeCanonicalMake(nativeMake ?? "");
  if (
    row.year === null ||
    !nativeMake ||
    !model ||
    /^(?:other|unknown)$/i.test(make)
  )
    return {
      status: "rejected",
      stock: row.stock,
      vin,
      reason: "invalid-native-ymm",
    };
  if (!vin)
    return {
      status: "rejected",
      stock: row.stock,
      vin: null,
      reason: "invalid-identity",
    };
  const color = vinplusOptionalText(row.color);
  return {
    status: "available",
    vehicle: {
      source: "uwrench",
      vin,
      year: row.year,
      make,
      model,
      color:
        color && !/^burn(?:t|ed)$/i.test(color)
          ? normalizeCanonicalColor(color)
          : null,
      stockNumber: row.stock,
      engine: vinplusOptionalText(row.engine),
      row: vinplusOptionalText(row.row),
      availableDate: vinplusSourceDate(record.dateAdded),
      imageUrl: null,
      locationCode: UWRENCH_YARD.code,
      locationName: UWRENCH_YARD.name,
      locationCity: UWRENCH_YARD.city,
      state: "Missouri",
      stateAbbr: "MO",
      lat: UWRENCH_YARD.lat,
      lng: UWRENCH_YARD.lng,
      detailsUrl: UWRENCH_INVENTORY_URL,
      section: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      trim: null,
      transmission: null,
    },
  };
}
