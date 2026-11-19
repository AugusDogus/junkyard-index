import { normalizeCanonicalVehicle } from "./normalization";
import { ArrivalDate } from "~/lib/arrival-date";
import { VinPattern } from "~/lib/vin-pattern";
import { buildAdvancedSearchTokens } from "~/lib/advanced-search-query";
import type { IngestionSource } from "~/lib/ingestion-source";

/**
 * Canonical vehicle type matching the Turso `vehicle` table.
 * This is the system-of-record representation used by all ingestion connectors.
 */
export interface CanonicalVehicle {
  vin: string;
  source: IngestionSource;
  year: number;
  make: string;
  model: string;
  sourceMake?: string | null;
  sourceModel?: string | null;
  color: string | null;
  stockNumber: string | null;
  imageUrl: string | null;
  availableDate: string | null;
  locationCode: string;
  locationName: string;
  locationCity: string;
  state: string;
  stateAbbr: string;
  lat: number;
  lng: number;
  section: string | null;
  row: string | null;
  space: string | null;
  detailsUrl: string | null;
  partsUrl: string | null;
  pricesUrl: string | null;
  engine: string | null;
  trim: string | null;
  transmission: string | null;
}

/**
 * Algolia record shape. Extends the canonical vehicle with Algolia-specific fields.
 * `objectID` = VIN (Algolia's primary key).
 * `_geoloc` enables native geo-search and distance sorting.
 * `availableDateTs` is a unix timestamp for numeric sorting/filtering.
 * `firstSeenAt` is a unix timestamp for alert diffing.
 */
export interface AlgoliaVehicleRecord {
  objectID: string;
  vin: string;
  vinPrefixes: string[];
  vinPositionTokens: string[];
  searchTokens: string[];
  source: IngestionSource;
  year: number;
  make: string;
  model: string;
  sourceMake?: string | null;
  sourceModel?: string | null;
  color: string | null;
  stockNumber: string | null;
  imageUrl: string | null;
  availableDate: string | null;
  arrivalDate: ArrivalDate;
  arrivalDateKnown: 0 | 1;
  availableDateTs: number;
  locationCode: string;
  locationName: string;
  locationCity: string;
  state: string;
  stateAbbr: string;
  section: string | null;
  row: string | null;
  space: string | null;
  detailsUrl: string | null;
  partsUrl: string | null;
  pricesUrl: string | null;
  engine: string | null;
  trim: string | null;
  transmission: string | null;
  firstSeenAt: number;
  isMissing: boolean;
  missingSinceAt: number | null;
  missingRunCount: number;
  _geoloc: { lat: number; lng: number };
}

/**
 * Result reported by each source connector after fetching inventory.
 */
export interface IngestionResult {
  source: string;
  vehicles: CanonicalVehicle[];
  /** Total vehicles processed (accurate even when streaming via onBatch). */
  count: number;
  errors: string[];
}

/**
 * Pure function: map a canonical vehicle + timestamps to an Algolia record.
 */
export function toAlgoliaRecord(
  rawVehicle: CanonicalVehicle,
  firstSeenAt: Date,
  missingSinceAt: Date | null,
  missingRunCount: number,
  observedArrivalAt: Date | null,
): AlgoliaVehicleRecord {
  const vehicle = normalizeCanonicalVehicle(rawVehicle);
  const arrivalDate = ArrivalDate.from(
    vehicle.availableDate,
    observedArrivalAt && Number.isFinite(observedArrivalAt.getTime())
      ? observedArrivalAt.toISOString()
      : null,
  );
  const availableDateTs =
    arrivalDate.kind === "unknown"
      ? 0
      : Math.floor(Date.parse(arrivalDate.date) / 1000);

  return {
    objectID: vehicle.vin,
    vin: vehicle.vin,
    vinPrefixes: VinPattern.toSearchPrefixes(vehicle.vin),
    vinPositionTokens: VinPattern.toIndexTokens(vehicle.vin),
    searchTokens: buildAdvancedSearchTokens([
      vehicle.make,
      vehicle.model,
      vehicle.sourceModel,
      vehicle.sourceMake,
      vehicle.trim,
      vehicle.year,
      vehicle.color,
      vehicle.vin,
    ]),
    source: vehicle.source,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    sourceMake: vehicle.sourceMake,
    sourceModel: vehicle.sourceModel,
    color: vehicle.color,
    stockNumber: vehicle.stockNumber,
    imageUrl: vehicle.imageUrl,
    availableDate: vehicle.availableDate,
    arrivalDate,
    arrivalDateKnown: arrivalDate.kind === "unknown" ? 0 : 1,
    availableDateTs,
    locationCode: vehicle.locationCode,
    locationName: vehicle.locationName,
    locationCity: vehicle.locationCity,
    state: vehicle.state,
    stateAbbr: vehicle.stateAbbr,
    section: vehicle.section,
    row: vehicle.row,
    space: vehicle.space,
    detailsUrl: vehicle.detailsUrl,
    partsUrl: vehicle.partsUrl,
    pricesUrl: vehicle.pricesUrl,
    engine: vehicle.engine,
    trim: vehicle.trim,
    transmission: vehicle.transmission,
    firstSeenAt: Math.floor(firstSeenAt.getTime() / 1000),
    isMissing: missingSinceAt !== null,
    missingSinceAt:
      missingSinceAt !== null
        ? Math.floor(missingSinceAt.getTime() / 1000)
        : null,
    missingRunCount,
    _geoloc: { lat: vehicle.lat, lng: vehicle.lng },
  };
}
