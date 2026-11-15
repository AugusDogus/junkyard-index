import { Yard } from "~/lib/yard";
import { normalizeRegion } from "./normalization";
import type { PickNSaveRecord } from "./picknsave-parser";
import type { PickNSaveYard } from "./picknsave-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type PickNSaveCanonicalVehicle = CanonicalVehicle & {
  source: "picknsave";
};

export function transformPickNSaveVehicle(
  record: PickNSaveRecord,
  yard: PickNSaveYard,
): PickNSaveCanonicalVehicle | null {
  const { lat, lng } = Yard.coordinates(yard.lat, yard.lng);
  if (
    lat === null ||
    lng === null ||
    record.yardCode !== yard.code ||
    !yard.address ||
    !yard.postalCode ||
    !yard.phone ||
    !yard.websiteUrl ||
    !yard.name ||
    !yard.city ||
    !yard.state
  )
    return null;
  return {
    vin: record.vin,
    source: "picknsave",
    year: record.year,
    make: record.make,
    model: record.model,
    color: record.color,
    stockNumber: record.stockNumber,
    imageUrl: record.imageUrl,
    availableDate: record.availableDate,
    row: record.row,
    detailsUrl: record.detailsUrl,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    ...normalizeRegion(yard.state),
    lat,
    lng,
    section: null,
    space: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
