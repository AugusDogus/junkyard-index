import { inventoryVin } from "./inventory-vin";
import { meeksImageUrl } from "./meeks-html";
import type { MeeksRecord } from "./meeks-parser";
import { MEEKS_FULL_INVENTORY_URL, MEEKS_YARD } from "./meeks-yard-metadata";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { CanonicalVehicle } from "./types";

export type MeeksCanonicalVehicle = CanonicalVehicle & {
  source: "meeks";
};
export type MeeksVehicleResult =
  | { status: "available"; vehicle: MeeksCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

export function meeksOptionalText(raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  return value &&
    value.length <= 100 &&
    /[a-z0-9]/i.test(value) &&
    !/[<>]/.test(value) &&
    !Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    !/^(?:other|unknown|none|null|undefined|n\/?a)$/i.test(value)
    ? value
    : null;
}

export function meeksSourceDate(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = 2000 + Number(match[3]);
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
    ? date.toISOString()
    : null;
}

export function transformMeeksRecord(record: MeeksRecord): MeeksVehicleResult {
  const vin = inventoryVin(record.vin, record.year);
  const year = /^\d{4}$/.test(record.year.trim()) ? Number(record.year) : NaN;
  const nativeMake = meeksOptionalText(record.make);
  const make = normalizeCanonicalMake(nativeMake ?? "");
  const model = meeksOptionalText(record.model);
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !nativeMake ||
    !model ||
    !/[a-z]/i.test(make)
  )
    return { status: "incomplete", vin };
  const color = normalizeCanonicalColor(meeksOptionalText(record.color));
  return {
    status: "available",
    vehicle: {
      source: "meeks",
      vin,
      year,
      make,
      model,
      color,
      stockNumber: meeksOptionalText(record.stock),
      imageUrl: meeksImageUrl(record.imageUrl),
      availableDate: meeksSourceDate(record.arrival),
      locationCode: MEEKS_YARD.code,
      locationName: MEEKS_YARD.name,
      locationCity: MEEKS_YARD.city,
      state: "Virginia",
      stateAbbr: "VA",
      lat: MEEKS_YARD.lat,
      lng: MEEKS_YARD.lng,
      section: meeksOptionalText(record.location),
      row: meeksOptionalText(record.row),
      space: null,
      detailsUrl: MEEKS_FULL_INVENTORY_URL,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
