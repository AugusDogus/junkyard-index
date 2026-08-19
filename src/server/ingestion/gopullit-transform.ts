import type { GopullitInventoryRecord } from "./gopullit-client";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";

const GOPULLIT_ORIGIN = "https://gopullit.com";

export interface GopullitLocation {
  code: string;
  locationName: string;
  city: string;
  state: string;
  stateAbbr: string;
  lat: number;
  lng: number;
}

export const GOPULLIT_LOCATIONS: readonly GopullitLocation[] = [
  {
    code: "GPI-JAX",
    locationName: "GO Pull-It - Jacksonville",
    city: "Jacksonville",
    state: "Florida",
    stateAbbr: "FL",
    lat: 30.33728017477757,
    lng: -81.7722659236203,
  },
  {
    code: "GPI-ATL-EAST",
    locationName: "GO Pull-It - Atlanta East",
    city: "Norcross",
    state: "Georgia",
    stateAbbr: "GA",
    lat: 33.96350977319068,
    lng: -84.18264502350434,
  },
  {
    code: "GPI-GAINESVILLE",
    locationName: "GO Pull-It - Gainesville",
    city: "Gainesville",
    state: "Georgia",
    stateAbbr: "GA",
    lat: 34.2778019,
    lng: -83.78331,
  },
  {
    code: "GPI-TALLAHASSEE",
    locationName: "GO Pull-It - Tallahassee",
    city: "Tallahassee",
    state: "Florida",
    stateAbbr: "FL",
    lat: 30.3883447,
    lng: -84.2765836,
  },
];

export interface CompleteGopullitInventoryRecord extends GopullitInventoryRecord {
  make: string;
  model: string;
  vin: string;
  yardCity: string;
  yardDate: string;
  yardState: string;
  year: string;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasGopullitVehicleMetadata(
  record: GopullitInventoryRecord,
): record is CompleteGopullitInventoryRecord {
  return (
    hasText(record.make) &&
    hasText(record.model) &&
    hasText(record.vin) &&
    hasText(record.yardCity) &&
    hasText(record.yardDate) &&
    hasText(record.yardState) &&
    hasText(record.year)
  );
}

export function resolveGopullitLocation(
  record: CompleteGopullitInventoryRecord,
): GopullitLocation | null {
  const city = record.yardCity.trim().toUpperCase();
  const stateAbbr = record.yardState.trim().toUpperCase();
  return (
    GOPULLIT_LOCATIONS.find(
      (location) =>
        location.city.toUpperCase() === city &&
        location.stateAbbr === stateAbbr,
    ) ?? null
  );
}

function parseAvailableDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number.parseInt(match[1] ?? "", 10);
  const day = Number.parseInt(match[2] ?? "", 10);
  const year = 2000 + Number.parseInt(match[3] ?? "", 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

function optionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function transformGopullitVehicle(
  record: CompleteGopullitInventoryRecord,
  location: GopullitLocation,
): CanonicalVehicle | null {
  const vin = record.vin.trim().toUpperCase();
  const year = Number.parseInt(record.year, 10);
  const model = record.model.trim();
  if (!vin || !model || !Number.isInteger(year) || year <= 0) return null;

  const [firstImage] = record.gallery ?? [];
  const imageUrl = optionalValue(firstImage?.full ?? firstImage?.thumbnail);
  const stockNumber = record.title.trim();
  const detailsUrl = new URL(
    `/inventory/${stockNumber.toLowerCase()}/`,
    GOPULLIT_ORIGIN,
  ).toString();

  return {
    vin,
    source: "gopullit",
    year,
    make: normalizeCanonicalMake(record.make),
    model,
    color: null,
    stockNumber: optionalValue(stockNumber),
    imageUrl,
    availableDate: parseAvailableDate(record.yardDate),
    locationCode: location.code,
    locationName: location.locationName,
    locationCity: location.city,
    state: location.state,
    stateAbbr: location.stateAbbr,
    lat: location.lat,
    lng: location.lng,
    section: null,
    row: optionalValue(record.location),
    space: null,
    detailsUrl,
    partsUrl: `${GOPULLIT_ORIGIN}/parts-price-list/`,
    pricesUrl: `${GOPULLIT_ORIGIN}/parts-price-list/`,
    engine: null,
    trim: null,
    transmission: null,
  };
}
