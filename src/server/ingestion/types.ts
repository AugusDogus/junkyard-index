/**
 * Canonical vehicle type matching the Turso `vehicle` table.
 * This is the system-of-record representation used by all ingestion connectors.
 */
export interface CanonicalVehicle {
  vin: string;
  source: "pyp" | "row52";
  year: number;
  make: string;
  model: string;
  color: string | null;
  stockNumber: string | null;
  imageUrl: string | null;
  availableDate: string | null;
  locationCode: string;
  locationName: string;
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
  source: "pyp" | "row52";
  year: number;
  make: string;
  model: string;
  color: string | null;
  stockNumber: string | null;
  imageUrl: string | null;
  availableDate: string | null;
  availableDateTs: number;
  locationCode: string;
  locationName: string;
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
  _geoloc: { lat: number; lng: number };
}

/**
 * Result reported by each source connector after fetching inventory.
 */
export interface IngestionResult {
  source: string;
  vehicles: CanonicalVehicle[];
  errors: string[];
}

/**
 * Pure function: map a canonical vehicle + timestamps to an Algolia record.
 */
export function toAlgoliaRecord(
  vehicle: CanonicalVehicle,
  firstSeenAt: Date,
): AlgoliaVehicleRecord {
  const parsedMs = vehicle.availableDate
    ? new Date(vehicle.availableDate).getTime()
    : NaN;
  const availableDateTs = Number.isNaN(parsedMs)
    ? 0
    : Math.floor(parsedMs / 1000);

  return {
    objectID: vehicle.vin,
    source: vehicle.source,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    stockNumber: vehicle.stockNumber,
    imageUrl: vehicle.imageUrl,
    availableDate: vehicle.availableDate,
    availableDateTs,
    locationCode: vehicle.locationCode,
    locationName: vehicle.locationName,
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
    _geoloc: { lat: vehicle.lat, lng: vehicle.lng },
  };
}
