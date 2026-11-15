import type { CanonicalVehicle } from "./types";
import { normalizeCanonicalMake } from "./normalization";
import { ALLIED_IMAGE_PREFIX } from "./allied-html";
import {
  AlliedRecord,
  type AlliedContext,
  type AlliedControl,
  type AlliedNativeIdentity,
} from "./allied-record";

export type AlliedCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "allied";
};
export interface AlliedLocation {
  code: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}
export type AlliedRecordResult = ReturnType<typeof AlliedRecord.assess> &
  (
    | {
        status: "available";
        vehicle: AlliedCanonicalVehicle;
        nativeIdentity: AlliedNativeIdentity;
      }
    | { status: "rejected"; vehicle: null }
  );
const image = (raw: string | null): string | null => {
  const url = raw === null ? null : URL.parse(raw);
  return url &&
    url.href.startsWith(ALLIED_IMAGE_PREFIX) &&
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
export function transformAlliedRecord(
  record: AlliedRecord,
  context: AlliedContext,
  location: AlliedLocation,
  published: readonly { make: AlliedControl; model: AlliedControl }[] = [],
): AlliedRecordResult {
  const assessed = AlliedRecord.assess(record, context, published);
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
      source: "allied",
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
      state: "New Hampshire",
      stateAbbr: "NH",
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
