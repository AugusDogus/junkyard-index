import { z } from "zod";
import { PontiacNameSchema, PontiacYearSchema } from "./pontiac-catalog";
import { normalizeCanonicalColor } from "./normalization";

export const PontiacIdSchema = z.number().int().positive().safe();
const stock = z
  .string()
  .regex(/^P\d{5,10}$/)
  .nullish();
const color = z.string().max(100).nullish();
const row = z.number().int().positive().max(10_000).nullish();
export const PontiacSearchSchema = z.object({
  vehicleID: PontiacIdSchema,
  stockID: stock,
  modelYear: PontiacYearSchema,
  modelMake: PontiacNameSchema,
  modelName: PontiacNameSchema,
  colorOfVehicle: color,
  yardRow: row,
});
export const PontiacDetailSchema = z.object({
  vehicleID: PontiacIdSchema,
  storeNumber: z.literal(105),
  stockID: stock,
  VIN: z.string().max(100).nullish(),
  modelYear: PontiacYearSchema,
  vehicleMake: PontiacNameSchema,
  modelName: PontiacNameSchema,
  colorOfVehicle: color,
  YardLocation: PontiacNameSchema,
  YardLocationDT: z.string().max(100).nullish(),
  YardRow: row,
  images: z
    .array(
      z.object({
        referenceID: PontiacIdSchema,
        displayOrder: z.number().int().nullish(),
        imageMedium: z.string().max(2048),
      }),
    )
    .max(100)
    .nullish(),
});
export const PontiacControlSchema = z.object({
  vehicleID: PontiacIdSchema,
  storeNumber: z.literal(105),
  modelYear: PontiacYearSchema,
  vehicleMake: PontiacNameSchema,
  modelName: PontiacNameSchema,
});
export type PontiacSearchRecord = z.infer<typeof PontiacSearchSchema>;
export type PontiacDetailRecord = z.infer<typeof PontiacDetailSchema>;

const knownColors = new Set([
  "Beige",
  "Black",
  "Blue",
  "Bronze",
  "Brown",
  "Burgundy",
  "Champagne",
  "Charcoal",
  "Copper",
  "Cream",
  "Gold",
  "Gray",
  "Green",
  "Maroon",
  "Multi",
  "Orange",
  "Pewter",
  "Pink",
  "Purple",
  "Red",
  "Silver",
  "Tan",
  "Teal",
  "Violet",
  "White",
  "Yellow",
]);

export function pontiacColor(value: string | null | undefined): string | null {
  const normalized = normalizeCanonicalColor(value ?? "");
  return normalized && knownColors.has(normalized) ? normalized : null;
}

export function pontiacComparable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function samePontiacSearch(
  a: PontiacSearchRecord,
  b: PontiacSearchRecord,
): boolean {
  const aColor = pontiacColor(a.colorOfVehicle);
  const bColor = pontiacColor(b.colorOfVehicle);
  const aStock = a.stockID ?? null;
  const bStock = b.stockID ?? null;
  const aRow = a.yardRow ?? null;
  const bRow = b.yardRow ?? null;
  return (
    a.vehicleID === b.vehicleID &&
    (aStock === null || bStock === null || aStock === bStock) &&
    a.modelYear === b.modelYear &&
    pontiacComparable(a.modelMake) === pontiacComparable(b.modelMake) &&
    pontiacComparable(a.modelName) === pontiacComparable(b.modelName) &&
    (aColor === null || bColor === null || aColor === bColor) &&
    (aRow === null || bRow === null || aRow === bRow)
  );
}
