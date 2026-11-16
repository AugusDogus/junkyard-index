import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { inventoryVin } from "./inventory-vin";
import {
  alln1OptionalText,
  alln1SourceDate,
  alln1Stock,
  type Alln1Record,
} from "./alln1-parser";
import {
  ALLN1_TENANT,
  alln1DetailsUrl,
  type Alln1Tenant,
  type Alln1Source,
} from "./alln1-yard-metadata";
import { normalizeCanonicalMake, normalizeRegion } from "./normalization";
import type { CanonicalVehicle } from "./types";

export type Alln1CanonicalVehicle<S extends Alln1Source = "alln1"> =
  CanonicalVehicle & { source: S };
export function transformUpullRecord<S extends Alln1Source>(
  record: Alln1Record,
  tenant: Alln1Tenant<S>,
):
  | { status: "available"; vehicle: Alln1CanonicalVehicle<S> }
  | { status: "incomplete"; vin: string | null }
  | {
      status: "quarantined";
      position: "HOLD" | "YARD VAN" | "REBUILDER";
      vin: string | null;
    } {
  const parseVin =
    tenant.vinValidation === "check-digit"
      ? inventoryVinWithCheckDigit
      : inventoryVin;
  const vin = parseVin(record.vin, record.year);
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
      source: tenant.source,
      vin,
      year,
      make,
      model,
      color: null,
      stockNumber: alln1Stock(record.stock),
      row: alln1OptionalText(position),
      availableDate: alln1SourceDate(record.setDate),
      imageUrl: record.imageUrl,
      locationCode: tenant.yard.code,
      locationName: tenant.yard.name,
      locationCity: tenant.yard.city,
      state: normalizeRegion("", tenant.yard.state).state,
      stateAbbr: tenant.yard.state,
      lat: tenant.yard.lat,
      lng: tenant.yard.lng,
      detailsUrl: alln1DetailsUrl(vin, tenant),
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

export const transformAlln1Record = (record: Alln1Record) =>
  transformUpullRecord(record, ALLN1_TENANT);
