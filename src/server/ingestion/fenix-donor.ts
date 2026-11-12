import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { FenixRecord } from "./fenix-parser";
import { fenixPhotoUrl } from "./fenix-photo";

export type FenixDonor = {
  vin: string;
  year: number;
  make: string;
  model: string;
  color: null;
  stockNumber: string | null;
  position: string | null;
  availableDate: string | null;
  photoUrl: string | null;
};
export type FenixDonorResult =
  | { status: "available"; donor: FenixDonor }
  | { status: "incomplete"; vin: string | null };

function sourceDate(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = 2000 + Number(match[3]);
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day &&
    date.getTime() <= Date.now()
    ? date.toISOString()
    : null;
}

export const FenixDonor = {
  parse(record: FenixRecord): FenixDonorResult {
    const vin = inventoryVin(record.vin, record.year);
    const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
    const make = normalizeCanonicalMake(record.make);
    const model = record.model.trim();
    if (
      !vin ||
      !Number.isInteger(year) ||
      year < 1886 ||
      year > 2100 ||
      !make ||
      /^(?:unknown|other|n\/a)$/i.test(make) ||
      !model ||
      /^(?:unknown|other|n\/a)$/i.test(model) ||
      /\b(?:hold|sold|crush(?:ed)?|removed|inactive)\b|not available/i.test(
        record.row,
      )
    )
      return { status: "incomplete", vin };
    return {
      status: "available",
      donor: {
        vin,
        year,
        make,
        model,
        color: null,
        stockNumber: /^[1-9]\d{8}$/.test(record.stock) ? record.stock : null,
        position:
          /^\d{1,3}$/.test(record.row.trim()) && Number(record.row) > 0
            ? record.row.trim()
            : null,
        availableDate: sourceDate(record.datePlacedInYard),
        photoUrl: fenixPhotoUrl(record.photoUrl, record.id),
      },
    };
  },
} as const;
