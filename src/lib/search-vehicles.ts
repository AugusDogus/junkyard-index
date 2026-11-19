import { ArrivalDate } from "~/lib/arrival-date";
import { hasFiniteCoordinates } from "~/lib/location-preferences";
import { calculateDistance } from "~/lib/utils";
import { isIngestionSource } from "~/lib/ingestion-source";
import type { DataSource, SearchVehicle } from "~/lib/types";

export const ALGOLIA_VEHICLE_HIT_ATTRIBUTES = [
  "objectID",
  "year",
  "make",
  "model",
  "color",
  "vin",
  "stockNumber",
  "availableDate",
  "arrivalDate",
  "source",
  "locationCode",
  "locationName",
  "locationCity",
  "state",
  "stateAbbr",
  "_geoloc",
  "section",
  "row",
  "space",
  "imageUrl",
  "detailsUrl",
  "partsUrl",
  "pricesUrl",
  "engine",
  "trim",
  "transmission",
  "isMissing",
  "missingSinceAt",
  "missingRunCount",
] as const;

// The search cards do not consume provider metadata, raw descriptions or highlights.
export const SEARCH_CARD_ATTRIBUTES = [
  "objectID",
  "year",
  "make",
  "model",
  "color",
  "vin",
  "stockNumber",
  "availableDate",
  "arrivalDate",
  "source",
  "locationCode",
  "locationName",
  "locationCity",
  "stateAbbr",
  "_geoloc",
  "section",
  "row",
  "space",
  "engine",
  "transmission",
  "imageUrl",
  "detailsUrl",
  "isMissing",
  "missingSinceAt",
] as const satisfies readonly AlgoliaVehicleHitAttribute[];

type AlgoliaVehicleHitAttribute =
  (typeof ALGOLIA_VEHICLE_HIT_ATTRIBUTES)[number];

export type AlgoliaVehicleHit = Partial<
  Record<AlgoliaVehicleHitAttribute, unknown>
> & { _rankingInfo?: unknown };

function parseDataSource(value: unknown): DataSource | null {
  return isIngestionSource(value) ? value : null;
}

function parseString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseGeoloc(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const lat = "lat" in value ? value.lat : null;
  const lng = "lng" in value ? value.lng : null;
  return typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    hasFiniteCoordinates({ lat, lng }) &&
    (lat !== 0 || lng !== 0)
    ? { lat, lng }
    : null;
}

function getFallbackLocationCity(
  locationName: string,
  stateAbbr: string,
): string {
  const escapedStateAbbr = stateAbbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return locationName
    .replace(/^AutoRecycler - /, "")
    .replace(/^Pick Your Part - /, "")
    .replace(/^PICK-n-PULL /, "")
    .replace(/^LKQ Pull-A-Part - /, "")
    .replace(new RegExp(`,\\s*${escapedStateAbbr}$`, "i"), "");
}

export function algoliaHitToSearchVehicle(
  hit: AlgoliaVehicleHit,
  userLocation?: { lat: number; lng: number },
): SearchVehicle | null {
  const geoloc = parseGeoloc(hit._geoloc);
  const lat = geoloc?.lat ?? 0;
  const lng = geoloc?.lng ?? 0;
  const source = parseDataSource(hit.source);
  if (source === null) return null;
  const locationName = parseString(hit.locationName);
  const stateAbbr = parseString(hit.stateAbbr);
  const locationCity =
    parseOptionalString(hit.locationCity) ??
    getFallbackLocationCity(locationName, stateAbbr);
  const missingSinceAtSeconds =
    typeof hit.missingSinceAt === "number" &&
    Number.isFinite(hit.missingSinceAt)
      ? hit.missingSinceAt
      : null;
  const missingSinceAt =
    missingSinceAtSeconds !== null
      ? new Date(missingSinceAtSeconds * 1000).toISOString()
      : undefined;

  const yardArrival = ArrivalDate.from(hit.availableDate, null);
  const ranking = hit._rankingInfo;
  const geoDistance =
    typeof ranking === "object" && ranking !== null && "geoDistance" in ranking
      ? ranking.geoDistance
      : null;
  const geoPrecision =
    typeof ranking === "object" && ranking !== null && "geoPrecision" in ranking
      ? ranking.geoPrecision
      : 1;
  // Algolia's geoDistance is in geoPrecision buckets (10 meters for Nearest).
  // Otherwise use the origin and yard coordinates without another request.
  const distance =
    typeof geoDistance === "number" &&
    Number.isFinite(geoDistance) &&
    geoDistance >= 0 &&
    typeof geoPrecision === "number" &&
    Number.isFinite(geoPrecision) &&
    geoPrecision > 0 &&
    Number.isFinite(geoDistance * geoPrecision)
      ? (geoDistance * geoPrecision) / 1609.344
      : userLocation && hasFiniteCoordinates(userLocation) && geoloc
        ? calculateDistance(userLocation.lat, userLocation.lng, lat, lng)
        : null;

  return {
    id: parseOptionalString(hit.objectID) ?? parseString(hit.vin),
    year: parseNumber(hit.year),
    make: parseString(hit.make),
    model: parseString(hit.model),
    color: parseString(hit.color),
    vin: parseOptionalString(hit.vin) ?? parseString(hit.objectID),
    stockNumber: parseString(hit.stockNumber),
    arrivalDate:
      yardArrival.kind === "yard"
        ? yardArrival
        : ArrivalDate.parse(hit.arrivalDate),
    source,
    locationCode: parseString(hit.locationCode),
    locationName,
    locationCity,
    state: parseString(hit.state),
    stateAbbr,
    lat,
    lng,
    distance,
    section: parseString(hit.section),
    row: parseString(hit.row),
    space: parseString(hit.space),
    imageUrl: parseOptionalString(hit.imageUrl) ?? null,
    detailsUrl: parseString(hit.detailsUrl).trim() || null,
    partsUrl: parseString(hit.partsUrl),
    pricesUrl: parseString(hit.pricesUrl),
    engine: parseOptionalString(hit.engine),
    trim: parseOptionalString(hit.trim),
    transmission: parseOptionalString(hit.transmission),
    isMissing: hit.isMissing === true,
    missingSinceAt,
    missingRunCount: parseNumber(hit.missingRunCount),
  };
}
