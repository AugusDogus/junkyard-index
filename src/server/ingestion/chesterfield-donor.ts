import { chesterfieldPhotoIdentity } from "./chesterfield-photo";
import type { ChesterfieldRecord } from "./chesterfield-parser";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";

export type ChesterfieldYardName = "Richmond" | "Fort Lee" | "Southside";
export type ChesterfieldDonor = {
  yard: ChesterfieldYardName;
  vin: string;
  year: number;
  make: string;
  model: string;
  color: string | null;
  stockNumber: string | null;
  position: string | null;
  availableDate: string | null;
  engine: string | null;
} & (
  | { photoUrl: string; blobIdentity: string }
  | { photoUrl: null; blobIdentity: null }
);
export type ChesterfieldDonorResult =
  | { status: "available"; donor: ChesterfieldDonor }
  | { status: "incomplete"; vin: string | null };

const colors = new Set([
  "Beige",
  "Black",
  "Blue",
  "Bronze",
  "Brown",
  "Burgundy",
  "Champagne",
  "Charcoal",
  "Copper",
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
export function chesterfieldYardName(raw: string): ChesterfieldYardName | null {
  return raw === "Richmond" || raw === "Fort Lee" || raw === "Southside"
    ? raw
    : null;
}
function sourceDate(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[3]);
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  return year >= 1886 &&
    year <= 2100 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day &&
    date.getTime() <= Date.now()
    ? date.toISOString()
    : null;
}

export const ChesterfieldDonor = {
  /** Field admission only. A photo reference still requires byte preservation. */
  parse(record: ChesterfieldRecord): ChesterfieldDonorResult {
    const vin = inventoryVin(record.vin, record.year);
    const yard = chesterfieldYardName(record.yard);
    const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
    const make = normalizeCanonicalMake(record.make);
    const model = record.model.trim();
    const normalizedColor = normalizeCanonicalColor(record.color);
    const color =
      normalizedColor && colors.has(normalizedColor) ? normalizedColor : null;
    const position = record.position.trim();
    const availableDate = sourceDate(record.arrivalDate);
    const photoUrl =
      record.images.find((url) => chesterfieldPhotoIdentity(url) !== null) ??
      null;
    const blobIdentity = photoUrl ? chesterfieldPhotoIdentity(photoUrl) : null;
    if (
      !yard ||
      !vin ||
      !Number.isInteger(year) ||
      year < 1886 ||
      year > 2100 ||
      !make ||
      /^(?:unknown|other)$/i.test(make) ||
      !model ||
      /^(?:unknown|other)$/i.test(model) ||
      /hold|crush/i.test(position)
    )
      return { status: "incomplete", vin };
    return {
      status: "available",
      donor: {
        yard,
        vin,
        year,
        make,
        model,
        color,
        stockNumber: /^\d{12}$/.test(record.stock) ? record.stock : null,
        position: position && !/unknown/i.test(position) ? position : null,
        availableDate,
        engine: record.engine.trim() || null,
        ...(photoUrl && blobIdentity
          ? { photoUrl, blobIdentity }
          : { photoUrl: null, blobIdentity: null }),
      },
    };
  },
} as const;
