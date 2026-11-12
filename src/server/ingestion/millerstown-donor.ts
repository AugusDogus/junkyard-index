import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { MillerstownRaw } from "./millerstown-pdf";
import type { CanonicalVehicle } from "./types";
import { MILLERSTOWN_YARD } from "./millerstown-yard-metadata";

export type MillerstownCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "millerstown";
};
export type MillerstownRejection =
  | "invalid-native-identity"
  | "invalid-source-year"
  | "missing-source-make"
  | "missing-source-model";
export type MillerstownDonorResult =
  | { status: "available"; vehicle: MillerstownCanonicalVehicle }
  | {
      status: "incomplete";
      vin: string | null;
      reasons: MillerstownRejection[];
    };
function optional(raw: string): string | null {
  const value = raw.trim();
  return !value || /^n\/a$/i.test(value) ? null : value;
}

export const MillerstownDonor = {
  parse(raw: MillerstownRaw): MillerstownDonorResult {
    const vin = inventoryVin(raw.vin, raw.year);
    const year =
      /^\d{4}$/.test(raw.year) &&
      Number(raw.year) >= 1886 &&
      Number(raw.year) <= 2100
        ? Number(raw.year)
        : null;
    const make = normalizeCanonicalMake(raw.make);
    const model = raw.model.trim();
    const reasons: MillerstownRejection[] = [];
    if (vin === null) reasons.push("invalid-native-identity");
    if (year === null) reasons.push("invalid-source-year");
    if (!make || /^(?:unknown|other|n\/a)$/i.test(make))
      reasons.push("missing-source-make");
    if (!model || /^(?:unknown|other|n\/a)$/i.test(model))
      reasons.push("missing-source-model");
    if (reasons.length || vin === null || year === null)
      return { status: "incomplete", vin, reasons };
    return {
      status: "available",
      vehicle: {
        source: "millerstown",
        vin,
        year,
        make,
        model,
        color: normalizeCanonicalColor(optional(raw.color)),
        stockNumber: optional(raw.stock),
        imageUrl: null,
        availableDate: null,
        locationCode: MILLERSTOWN_YARD.code,
        locationName: MILLERSTOWN_YARD.name,
        locationCity: MILLERSTOWN_YARD.city,
        state: "Pennsylvania",
        stateAbbr: MILLERSTOWN_YARD.state,
        lat: MILLERSTOWN_YARD.lat,
        lng: MILLERSTOWN_YARD.lng,
        section: null,
        row: null,
        space: null,
        detailsUrl: null,
        partsUrl: null,
        pricesUrl: null,
        engine: optional(raw.engine),
        trim: optional(raw.trim),
        transmission: optional(raw.transmission),
      },
    };
  },
} as const;
