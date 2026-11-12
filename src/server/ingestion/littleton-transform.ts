import { inventoryVin } from "./inventory-vin";
import {
  littletonOptionalText,
  littletonSourceDate,
  type LittletonRecord,
} from "./littleton-parser";
import {
  LITTLETON_INVENTORY_URL,
  LITTLETON_YARD,
} from "./littleton-yard-metadata";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { CanonicalVehicle } from "./types";

export type LittletonCanonicalVehicle = CanonicalVehicle & {
  source: "littleton";
};
export function littletonRecordIdentity(record: LittletonRecord) {
  return {
    stock: record.stock,
    year: record.year,
    vin: typeof record.vin === "string" ? record.vin.trim().toUpperCase() : "",
    make: littletonOptionalText(record.make),
    model: littletonOptionalText(record.model),
    color: littletonOptionalText(record.color),
    row: littletonOptionalText(record.vehicleRow),
    date: littletonSourceDate(record.dateAdded),
  };
}
export function transformLittletonRecord(
  record: LittletonRecord,
):
  | { status: "available"; vehicle: LittletonCanonicalVehicle }
  | { status: "incomplete"; vin: string | null } {
  const native = littletonRecordIdentity(record);
  const vin = inventoryVin(native.vin, String(native.year));
  const make = normalizeCanonicalMake(native.make ?? "");
  if (
    !vin ||
    !native.make ||
    !native.model ||
    /^(?:other|unknown)$/i.test(make)
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "littleton",
      vin,
      year: native.year,
      make,
      model: native.model,
      color:
        native.color && !/^burn(?:t|ed)$/i.test(native.color)
          ? normalizeCanonicalColor(native.color)
          : null,
      stockNumber: native.stock,
      imageUrl: null,
      availableDate: native.date,
      locationCode: LITTLETON_YARD.code,
      locationName: LITTLETON_YARD.name,
      locationCity: LITTLETON_YARD.city,
      state: "Colorado",
      stateAbbr: "CO",
      lat: LITTLETON_YARD.lat,
      lng: LITTLETON_YARD.lng,
      row: native.row,
      section: null,
      space: null,
      detailsUrl: LITTLETON_INVENTORY_URL,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
