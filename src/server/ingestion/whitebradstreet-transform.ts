import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";
import type { CanonicalVehicle } from "./types";
import {
  WHITEBRADSTREET_CATALOG,
  WHITEBRADSTREET_YARD,
} from "./whitebradstreet-yard-metadata";

export type WhitebradstreetCanonicalVehicle = CanonicalVehicle & {
  source: "whitebradstreet";
};
const missing = (value: string) =>
  /^(?:n\/?a|unknown|other|not available|-)?$/i.test(value.trim());

export function transformWhitebradstreetRecord(
  record: TruckPartsCatalogRecord,
):
  | { status: "available"; vehicle: WhitebradstreetCanonicalVehicle }
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
      WHITEBRADSTREET_CATALOG.origin +
        WHITEBRADSTREET_CATALOG.detailPath +
        "?truck=" +
        record.id
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "whitebradstreet",
      vin,
      year: Number(record.year),
      make,
      model,
      stockNumber: record.stockNumber?.trim() || null,
      imageUrl: record.imageUrl,
      detailsUrl: record.detailsUrl,
      locationCode: WHITEBRADSTREET_YARD.code,
      locationName: WHITEBRADSTREET_YARD.name,
      locationCity: WHITEBRADSTREET_YARD.city,
      state: "Maine",
      stateAbbr: "ME",
      lat: WHITEBRADSTREET_YARD.lat,
      lng: WHITEBRADSTREET_YARD.lng,
      color: null,
      availableDate: null,
      section: null,
      row: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      engine: record.engine?.trim() || null,
      trim: null,
      transmission: null,
    },
  };
}
