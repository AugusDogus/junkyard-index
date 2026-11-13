import type { CanonicalVehicle } from "./types";
import { normalizeCanonicalMake } from "./normalization";
import { PRATT_IMAGE_PREFIX } from "./pratt-html";
import {
  PrattRecord,
  type PrattContext,
  type PrattControl,
  type PrattNativeIdentity,
} from "./pratt-record";

export type PrattCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "pratt";
};
export interface PrattLocation {
  code: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}
export type PrattRecordResult = ReturnType<typeof PrattRecord.assess> &
  (
    | {
        status: "available";
        vehicle: PrattCanonicalVehicle;
        nativeIdentity: PrattNativeIdentity;
      }
    | { status: "rejected"; vehicle: null }
  );
const image = (raw: string | null): string | null => {
  const url = raw === null ? null : URL.parse(raw);
  return url &&
    url.href.startsWith(PRATT_IMAGE_PREFIX) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    ? url.href
    : null;
};
const date = (raw: string | null) => {
  if (raw === null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const value = new Date(raw + "T00:00:00Z");
  return Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === raw
    ? raw
    : null;
};
export function transformPrattRecord(
  record: PrattRecord,
  context: PrattContext,
  location: PrattLocation,
  published: readonly { make: PrattControl; model: PrattControl }[] = [],
): PrattRecordResult {
  const assessed = PrattRecord.assess(record, context, published);
  const { vin, year, nativeIdentity, destination } = assessed;
  if (
    assessed.reasons.length ||
    vin === null ||
    year === null ||
    nativeIdentity === null ||
    destination === null
  )
    return { ...assessed, status: "rejected", vehicle: null };
  return {
    ...assessed,
    nativeIdentity,
    status: "available",
    vehicle: {
      source: "pratt",
      vin,
      year,
      make: normalizeCanonicalMake(nativeIdentity.make),
      model: nativeIdentity.model,
      stockNumber:
        record.stock && record.stock.length <= 100 ? record.stock : null,
      imageUrl: image(record.image),
      availableDate: date(record.date),
      color: null,
      locationCode: location.code,
      locationName: location.name,
      locationCity: location.city,
      state: "Arkansas",
      stateAbbr: "AR",
      lat: location.lat,
      lng: location.lng,
      detailsUrl: destination,
      partsUrl: null,
      pricesUrl: null,
      section: null,
      row: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
