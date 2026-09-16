import type { CanonicalVehicle } from "./types";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import {
  IPULLUPULL_INVENTORY_URL,
  type IPullUPullRecord,
} from "./ipullupull-client";
import type { IPullUPullYard } from "./ipullupull-yard-metadata";

export type IPullUPullCanonicalVehicle = CanonicalVehicle & {
  source: "ipullupull";
};

export function ipullUPullVin(record: IPullUPullRecord): string | null {
  return inventoryVin(record.Vin, record.Year);
}

export function isUsableIPullUPullRecord(record: IPullUPullRecord): boolean {
  const year = Number(record.Year);
  return (
    ipullUPullVin(record) !== null &&
    /^\d{4}$/.test(record.Year.trim()) &&
    year >= 1886 &&
    year <= new Date().getUTCFullYear() + 1 &&
    record.Make.trim().length > 0 &&
    record.Model.trim().length > 0
  );
}

function availableDate(value: string): string | null {
  // The provider supplies a local timestamp without a zone. Retain only its
  // published calendar date, rather than inventing a UTC arrival time.
  const day = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.exec(
    value.trim(),
  )?.[1];
  if (!day) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === day
    ? date.toISOString()
    : null;
}

export function transformIPullUPullVehicle(
  record: IPullUPullRecord,
  yard: IPullUPullYard,
  imageUrl: string | null = null,
): IPullUPullCanonicalVehicle | null {
  const vin = ipullUPullVin(record);
  if (
    !vin ||
    !isUsableIPullUPullRecord(record) ||
    yard.lat === null ||
    yard.lng === null
  )
    return null;
  return {
    source: "ipullupull",
    vin,
    year: Number(record.Year),
    make: normalizeCanonicalMake(record.Make),
    model: record.Model.trim(),
    color: normalizeCanonicalColor(record.Color),
    stockNumber: record["Stock Number"].trim() || null,
    imageUrl,
    availableDate: availableDate(record["Yard Date"]),
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    ...normalizeRegion(yard.state),
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row: record["Vehicle Row"].trim() || null,
    space: null,
    detailsUrl: ipullUPullDetailsUrl(record),
    partsUrl: null,
    pricesUrl: IPULLUPULL_INVENTORY_URL,
    engine: record.Engine.trim() || null,
    trim: null,
    transmission: record.Transmission.trim() || null,
  };
}

/** These are the catalog's own Copy Link/search parameters, not asset routes. */
export function ipullUPullDetailsUrl(record: IPullUPullRecord): string {
  const url = new URL(IPULLUPULL_INVENTORY_URL);
  const stock = record["Stock Number"].trim();
  if (stock) url.searchParams.set("ipull_inventory_pricing_search", stock);
  for (const [field, value] of Object.entries({
    yard_city: record["Yard City"],
    make: record.Make,
    model: record.Model,
  })) {
    if (value.trim())
      url.searchParams.set(
        `ipull_inventory_pricing_filter[${field}]`,
        value.trim(),
      );
  }
  return url.href;
}
