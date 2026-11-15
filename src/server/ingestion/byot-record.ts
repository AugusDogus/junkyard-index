import { z } from "zod";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { ByotYard } from "./byot-configuration";

export const ByotRecordSchema = z.object({
  VehicleRno: z.number().int().positive(),
  StockId: z.string().trim().min(1),
  VIN: z.string().trim().min(1),
  Year: z
    .number()
    .int()
    .min(1886)
    .max(new Date().getUTCFullYear() + 1),
  Make: z.string().trim().min(1),
  Model: z.string().trim().min(1),
  Color: z.string().nullable().optional(),
  Reference: z.string().nullable().optional(),
  YardDtTm: z.string().nullable().optional(),
  YardRow: z.union([z.string(), z.number()]).nullable().optional(),
  images: z
    .array(z.string())
    .max(20)
    .nullish()
    .transform((images) => images ?? []),
});
export type ByotRecord = z.infer<typeof ByotRecordSchema>;
export function byotRecord(raw: unknown, yard: ByotYard) {
  const parsed = ByotRecordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const record = parsed.data;
  const vin = inventoryVinWithCheckDigit(record.VIN, String(record.Year));
  if (!vin || !new RegExp(`^${yard.stockPrefix}\\d+$`).test(record.StockId))
    return null;
  return { ...record, VIN: vin };
}
export function transformByotRecord(
  record: ByotRecord,
  yard: ByotYard,
): CanonicalVehicle {
  const date =
    record.YardDtTm && Number.isFinite(Date.parse(record.YardDtTm))
      ? new Date(record.YardDtTm).toISOString()
      : null;
  const image =
    record.images.find((url) =>
      url.startsWith(
        "https://storage.googleapis.com/byotautoparts.appspot.com/yard_inventory/",
      ),
    ) ?? null;
  return {
    vin: record.VIN,
    source: "byot",
    year: record.Year,
    make: normalizeCanonicalMake(record.Make),
    model: record.Model,
    color: record.Color?.trim() || null,
    stockNumber: record.StockId,
    imageUrl: image,
    availableDate: date,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    state: yard.stateName,
    stateAbbr: yard.state,
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row:
      record.YardRow === undefined || record.YardRow === null
        ? null
        : String(record.YardRow),
    space: null,
    detailsUrl: yard.inventoryUrl,
    partsUrl: null,
    pricesUrl: null,
    engine: record.Reference?.trim() || null,
    trim: null,
    transmission: null,
  };
}
