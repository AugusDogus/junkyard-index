import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { vinplusOptionalText, vinplusSourceDate } from "./vinplus-protocol";
import type { JolietRecord } from "./joliet-parser";
import { JOLIET_INVENTORY_URL, JOLIET_YARD } from "./joliet-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type JolietCanonicalVehicle = CanonicalVehicle & { source: "joliet" };

/** Fingerprint native fields in a fixed order. daysInYard is derived from the
 * current clock and is intentionally absent; every stable source field remains.
 */
export function jolietRecordIdentity(record: JolietRecord) {
  return {
    stock: record.stock,
    year: record.year,
    vin: record.vin ?? null,
    make: record.make ?? null,
    model: record.model ?? null,
    color: record.color ?? null,
    row: record.vehicleRow ?? null,
    date: record.dateAdded ?? null,
    yardLocation: record.yardLocation,
    sourceSystem: record.sourceSystem,
    demoOffset: record.demo_offset_seconds ?? null,
    damage: record.damage_condition ?? null,
    engine: record.engine ?? null,
    fuel: record.fuel_type ?? null,
    transmission: record.transmission ?? null,
    image: record.imageUrl ?? null,
    images: record.imageUrls ?? null,
  };
}
export function transformJolietRecord(
  record: JolietRecord,
):
  | { status: "available"; vehicle: JolietCanonicalVehicle }
  | { status: "incomplete"; vin: string | null } {
  const vin =
    typeof record.vin === "string"
      ? inventoryVin(record.vin, String(record.year))
      : null;
  const nativeMake = vinplusOptionalText(record.make);
  const model = vinplusOptionalText(record.model);
  const make = normalizeCanonicalMake(nativeMake ?? "");
  if (
    !vin ||
    !nativeMake ||
    !model ||
    /^(?:other|unknown)$/i.test(make) ||
    !Number.isInteger(record.year) ||
    record.year < 1886 ||
    record.year > 2100
  )
    return { status: "incomplete", vin };
  const color = vinplusOptionalText(record.color);
  return {
    status: "available",
    vehicle: {
      source: "joliet",
      vin,
      year: record.year,
      make,
      model,
      color:
        color && !/^burn(?:t|ed)$/i.test(color)
          ? normalizeCanonicalColor(color)
          : null,
      stockNumber: record.stock,
      row: vinplusOptionalText(record.vehicleRow),
      availableDate: vinplusSourceDate(record.dateAdded),
      imageUrl: null,
      locationCode: JOLIET_YARD.code,
      locationName: JOLIET_YARD.name,
      locationCity: JOLIET_YARD.city,
      state: "Illinois",
      stateAbbr: "IL",
      lat: JOLIET_YARD.lat,
      lng: JOLIET_YARD.lng,
      detailsUrl: JOLIET_INVENTORY_URL,
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
