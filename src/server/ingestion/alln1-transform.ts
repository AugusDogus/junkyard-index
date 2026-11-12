import { inventoryVin } from "./inventory-vin";
import {
  alln1OptionalText,
  alln1SourceDate,
  alln1Stock,
  type Alln1Record,
} from "./alln1-parser";
import { ALLN1_YARD, alln1DetailsUrl } from "./alln1-yard-metadata";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";

export type Alln1CanonicalVehicle = CanonicalVehicle & { source: "alln1" };
export function transformAlln1Record(record: Alln1Record):
  | { status: "available"; vehicle: Alln1CanonicalVehicle }
  | { status: "incomplete"; vin: string | null }
  | {
      status: "quarantined";
      position: "HOLD" | "YARD VAN" | "REBUILDER";
      vin: string | null;
    } {
  const vin = inventoryVin(record.vin, record.year);
  const position = record.position.trim();
  // These are literal source positions with unproven donor availability.
  // Quarantine is an admission decision, not an inferred native status meaning.
  if (
    position === "HOLD" ||
    position === "YARD VAN" ||
    position === "REBUILDER"
  )
    return { status: "quarantined", position, vin };
  const make = normalizeCanonicalMake(record.make);
  const model = alln1OptionalText(record.model);
  const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !alln1OptionalText(make) ||
    !/[A-Z]/i.test(make) ||
    !model
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "alln1",
      vin,
      year,
      make,
      model,
      color: null,
      stockNumber: alln1Stock(record.stock),
      row: alln1OptionalText(position),
      availableDate: alln1SourceDate(record.setDate),
      imageUrl: record.imageUrl,
      locationCode: ALLN1_YARD.code,
      locationName: ALLN1_YARD.name,
      locationCity: ALLN1_YARD.city,
      state: "Missouri",
      stateAbbr: "MO",
      lat: ALLN1_YARD.lat,
      lng: ALLN1_YARD.lng,
      detailsUrl: alln1DetailsUrl(vin),
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
