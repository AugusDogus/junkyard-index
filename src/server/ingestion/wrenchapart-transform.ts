import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { WrenchApartVehicle } from "./wrenchapart-client";
import type { LocatedWrenchApartYard } from "./wrenchapart-yard-metadata";

export type WrenchApartCanonicalVehicle = CanonicalVehicle & {
  source: "wrenchapart";
};

export function transformWrenchApartVehicle(
  record: WrenchApartVehicle,
  yard: LocatedWrenchApartYard,
  pricesUrl: string | null,
): WrenchApartCanonicalVehicle | null {
  const vin = record.vin?.trim().toUpperCase();
  const year = record.modelYear;
  const make = record.make?.name.trim();
  const model = record.model?.name.trim();
  // Preserve provider VINs, including pre-1981 identifiers, as other connectors do.
  if (
    !vin ||
    year === null ||
    year === undefined ||
    !Number.isInteger(year) ||
    year <= 0 ||
    !make ||
    !model
  )
    return null;
  const date = record.dateAdded ? new Date(record.dateAdded) : null;
  const image = record.photo ? URL.parse(record.photo) : null;
  return {
    vin,
    source: "wrenchapart",
    year,
    make: normalizeCanonicalMake(make),
    model,
    color: normalizeCanonicalColor(record.color ?? null),
    stockNumber: record.stockNumber?.trim() || null,
    imageUrl:
      image &&
      ["https:", "http:"].includes(image.protocol) &&
      !image.username &&
      !image.password
        ? image.href
        : null,
    availableDate:
      date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    ...normalizeRegion(yard.state, null),
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row:
      record.row?.id === null || record.row?.id === undefined
        ? null
        : String(record.row.id),
    space: null,
    // Public Vehicle Browser "More info" links use this persistent VIN route.
    detailsUrl: `https://wrenchapart.com/vehicle-info/${encodeURIComponent(vin)}`,
    partsUrl: null,
    pricesUrl,
    engine: null,
    trim: null,
    transmission: null,
  };
}
