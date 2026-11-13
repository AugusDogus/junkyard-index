import type { CanonicalVehicle } from "./types";
import { normalizeCanonicalMake } from "./normalization";
import {
  Cars4PartsRecord,
  type Cars4PartsRecord as NativeRecord,
} from "./cars4parts-record";
import { CARS4PARTS_ORIGIN, cars4partsOwnedUrl } from "./cars4parts-html";

export type Cars4PartsCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "cars4parts";
};
export interface Cars4PartsLocation {
  code: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}
export const cars4partsOptional = (claims: readonly string[]) => {
  const values = [...new Set(claims.filter(Boolean))];
  return values.length === 1 ? (values[0] ?? null) : null;
};
export function transformCars4PartsRecord(
  record: NativeRecord,
  makes: readonly string[],
  location: Cars4PartsLocation,
) {
  const assessed = Cars4PartsRecord.assess(record, makes);
  const { vin, year, make, model } = assessed;
  if (
    assessed.reasons.length ||
    assessed.role !== "donor" ||
    !vin ||
    year === null ||
    !make ||
    !model
  )
    return { ...assessed, status: "rejected", vehicle: null } as const;
  const image = cars4partsOptional(record.images);
  const imageUrl = image === null ? null : cars4partsOwnedUrl(image);
  const stock = cars4partsOptional(record.stock);
  const color = cars4partsOptional(record.colors);
  const vehicle: Cars4PartsCanonicalVehicle = {
    source: "cars4parts",
    vin,
    year,
    make: normalizeCanonicalMake(make),
    model,
    stockNumber: stock !== null && stock.length <= 100 ? stock : null,
    color: color !== null && color.length <= 100 ? color : null,
    imageUrl:
      imageUrl?.href.startsWith(CARS4PARTS_ORIGIN + "/wp-content/uploads/") &&
      /\.(?:jpe?g|png|webp)$/i.test(imageUrl.pathname)
        ? imageUrl.href
        : null,
    availableDate: null,
    locationCode: location.code,
    locationName: location.name,
    locationCity: location.city,
    state: "Illinois",
    stateAbbr: "IL",
    lat: location.lat,
    lng: location.lng,
    detailsUrl: record.destination,
    partsUrl: null,
    pricesUrl: null,
    section: null,
    row: null,
    space: null,
    engine: null,
    trim: null,
    transmission: null,
  };
  return { ...assessed, status: "available", vehicle } as const;
}
