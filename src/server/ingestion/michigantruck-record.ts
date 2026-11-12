import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import {
  MICHIGANTRUCK_ORIGIN,
  MICHIGANTRUCK_YARD,
} from "./michigantruck-yard-metadata";
import type { CanonicalVehicle } from "./types";

const field = z.string().max(500);
export const MichigantruckRecordSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,11}$/),
    year: field,
    make: field,
    model: field,
    vin: field,
    stockNumber: field.nullable(),
    imageUrl: z.string().max(4096).nullable(),
    detailsUrl: z.string().max(1000),
    condition: z.enum(["Salvage", "Complete"]),
    engine: field.nullable(),
  })
  .strict();
export type MichigantruckRecord = z.infer<typeof MichigantruckRecordSchema>;
export type MichigantruckCanonicalVehicle = CanonicalVehicle & {
  source: "michigantruck";
};
export type MichigantruckVehicleResult =
  | { status: "available"; vehicle: MichigantruckCanonicalVehicle }
  | { status: "incomplete"; vin: string | null }
  | { status: "excluded" };

function missing(value: string): boolean {
  return (
    /^(?:|other|unknown|none|null|undefined|na|notavailable|0+)$/.test(
      value.toLowerCase().replace(/[\s/_.-]+/g, ""),
    ) || !/[A-Z0-9]/i.test(value)
  );
}
export function michigantruckDetailUrl(raw: string): string | null {
  const url = URL.parse(raw);
  return url &&
    url.href === raw &&
    url.origin === MICHIGANTRUCK_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/truck-details\/[a-z0-9]+(?:-[a-z0-9]+)*-[1-9]\d{0,11}$/.test(
      url.pathname,
    )
    ? url.href
    : null;
}
export function michigantruckPhotoUrl(raw: string | null): string | null {
  if (raw !== null && raw.length > 4096) return null;
  const url = raw === null ? null : URL.parse(raw);
  return url &&
    url.href === raw &&
    url.origin === "https://images.truckpartsinventory.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/trucks\/6\/[a-z0-9][a-z0-9._()-]*\.(?:jpe?g|png|webp)$/i.test(
      url.pathname,
    ) &&
    !/(?:placeholder|loading|no[-_]?image)/i.test(url.pathname)
    ? url.href
    : null;
}
export function transformMichigantruckRecord(
  record: MichigantruckRecord,
): MichigantruckVehicleResult {
  if (record.condition === "Complete") return { status: "excluded" };
  const vin = inventoryVin(record.vin, record.year);
  const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !/[A-Z]/i.test(make) ||
    missing(make) ||
    missing(model) ||
    michigantruckDetailUrl(record.detailsUrl) === null
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "michigantruck",
      vin,
      year,
      make,
      model,
      stockNumber:
        record.stockNumber &&
        !missing(record.stockNumber) &&
        /^[A-Z0-9][A-Z0-9 ./-]{0,49}$/i.test(record.stockNumber)
          ? record.stockNumber
          : null,
      imageUrl: michigantruckPhotoUrl(record.imageUrl),
      detailsUrl: record.detailsUrl,
      locationCode: MICHIGANTRUCK_YARD.code,
      locationName: MICHIGANTRUCK_YARD.name,
      locationCity: MICHIGANTRUCK_YARD.city,
      state: "Michigan",
      stateAbbr: "MI",
      lat: MICHIGANTRUCK_YARD.lat,
      lng: MICHIGANTRUCK_YARD.lng,
      color: null,
      availableDate: null,
      section: null,
      row: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      engine:
        record.engine && record.engine.length <= 500 && !missing(record.engine)
          ? record.engine
          : null,
      trim: null,
      transmission: null,
    },
  };
}
