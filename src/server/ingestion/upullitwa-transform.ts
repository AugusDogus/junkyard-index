import type { CanonicalVehicle } from "./types";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake, normalizeRegion } from "./normalization";
import { upullitwaPageUrl, type UpullitwaRecord } from "./upullitwa-client";
import type { LocatedUpullitwaYard } from "./upullitwa-yard-metadata";

export type UpullitwaCanonicalVehicle = CanonicalVehicle & {
  source: "upullitwa";
};

export function transformUpullitwaVehicle(
  record: UpullitwaRecord,
  yard: LocatedUpullitwaYard,
): UpullitwaCanonicalVehicle | null {
  const vin = inventoryVin(record.vin, record.year);
  const year = Number(record.year);
  const make = record.make.trim();
  const model = record.model.trim();
  // Preserve legitimate pre-1981 identifiers, but do not accept placeholders or
  // malformed modern VINs as vehicle identity. No check-digit restriction.
  if (
    !/^\d{4}$/.test(record.year) ||
    year < 1900 ||
    year > new Date().getUTCFullYear() + 1 ||
    !make ||
    !model ||
    !vin
  )
    return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(record.date)
    ? new Date(`${record.date}T00:00:00.000Z`)
    : null;
  const image = record.imageUrl?.trim()
    ? URL.parse(record.imageUrl, upullitwaPageUrl(yard.code, 1))
    : null;
  // The provider's GET search form persists both yard and VIN. A page number
  // would instead send older vehicles to an unrelated first page of inventory.
  const detailsUrl = new URL(upullitwaPageUrl(yard.code, 1));
  detailsUrl.searchParams.delete("pagenum");
  detailsUrl.searchParams.set("search", vin);
  return {
    vin,
    source: "upullitwa",
    year,
    make: normalizeCanonicalMake(make),
    model,
    color: null,
    stockNumber: record.stockNumber || null,
    imageUrl:
      image &&
      ["https:", "http:"].includes(image.protocol) &&
      !image.username &&
      !image.password &&
      ![image.href, ...image.searchParams.values()].some((value) =>
        /placeholder|no[-_+ ]?image/i.test(value),
      )
        ? image.href
        : null,
    availableDate:
      date &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === record.date
        ? date.toISOString()
        : null,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    ...normalizeRegion(yard.state, null),
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row: record.row || null,
    space: null,
    detailsUrl: detailsUrl.href,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
