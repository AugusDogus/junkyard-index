import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import {
  RIVERVALLEY_CATALOG,
  RIVERVALLEY_YARD,
} from "./rivervalley-yard-metadata";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";
import type { CanonicalVehicle } from "./types";

export type RivervalleyCanonicalVehicle = CanonicalVehicle & {
  source: "rivervalley";
};
const missing = (value: string) =>
  /^(?:n\/?a|unknown|other|not available|-)?$/i.test(value.trim());

export function transformRivervalleyRecord(
  record: TruckPartsCatalogRecord,
):
  | { status: "available"; vehicle: RivervalleyCanonicalVehicle }
  | { status: "incomplete"; vin: string | null } {
  const vin = inventoryVin(record.vin, record.year);
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  if (
    !vin ||
    !/^\d{4}$/.test(record.year) ||
    Number(record.year) < 1886 ||
    Number(record.year) > 2100 ||
    missing(make) ||
    missing(model) ||
    record.detailsUrl !==
      RIVERVALLEY_CATALOG.origin +
        RIVERVALLEY_CATALOG.detailPath +
        "?truck=" +
        record.id
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "rivervalley",
      vin,
      year: Number(record.year),
      make,
      model,
      stockNumber:
        record.stockNumber && !missing(record.stockNumber)
          ? record.stockNumber
          : null,
      imageUrl: record.imageUrl,
      detailsUrl: record.detailsUrl,
      locationCode: RIVERVALLEY_YARD.code,
      locationName: RIVERVALLEY_YARD.name,
      locationCity: RIVERVALLEY_YARD.city,
      state: "Illinois",
      stateAbbr: "IL",
      lat: RIVERVALLEY_YARD.lat,
      lng: RIVERVALLEY_YARD.lng,
      color: null,
      availableDate: null,
      section: null,
      row: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      engine: record.engine && !missing(record.engine) ? record.engine : null,
      trim: null,
      transmission: null,
    },
  };
}
