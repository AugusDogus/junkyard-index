import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { NvpapRecord } from "./nvpap-parser";
import {
  NVPAP_ORIGIN,
  nvpapInventoryUrl,
  type NvpapYard,
} from "./nvpap-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type NvpapCanonicalVehicle = CanonicalVehicle & { source: "nvpap" };
export type NvpapVehicleResult =
  | { status: "available"; vehicle: NvpapCanonicalVehicle }
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
function sourceDate(raw: string): string | null {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(raw);
  if (!match) return null;
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].findIndex((m) => m === match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return month >= 0 &&
    year >= 1886 &&
    year <= 2100 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
    ? date.toISOString()
    : null;
}

export function transformNvpapRecord(
  record: NvpapRecord,
  yard: NvpapYard,
): NvpapVehicleResult {
  const vin = inventoryVin(record.vin, String(record.year));
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  const normalizedColor = normalizeCanonicalColor(record.color);
  const color =
    normalizedColor && colors.has(normalizedColor) ? normalizedColor : null;
  const availableDate = sourceDate(record.date);
  const row = /^Row [1-9]\d*$/.test(record.row) ? record.row : null;
  const validStock =
    /^[LH]\d{6}$/.test(record.stock) &&
    record.stock.startsWith(yard.code === "1074" ? "L" : "H");
  const imageUrl = validStock
    ? record.images.find((raw) => {
        const url = URL.parse(raw);
        return (
          url &&
          url.origin === NVPAP_ORIGIN &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          new RegExp(
            "^/photos/preview_photos/" +
              record.stock +
              "_(?:left|right|back|interior)\\.JPG$",
          ).test(url.pathname)
        );
      })
    : undefined;
  if (
    !vin ||
    !make ||
    /^(?:other|unknown)$/i.test(make) ||
    !model ||
    /^(?:other|unknown)$/i.test(model) ||
    !Number.isInteger(record.year) ||
    record.year < 1886 ||
    record.year > 2100 ||
    yard.lat === null ||
    yard.lng === null
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "nvpap",
      vin,
      year: record.year,
      make,
      model,
      color,
      stockNumber: validStock ? record.stock : null,
      row,
      availableDate,
      imageUrl: imageUrl ?? null,
      detailsUrl: nvpapInventoryUrl(yard.code),
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      state: "Nevada",
      stateAbbr: "NV",
      lat: yard.lat,
      lng: yard.lng,
      section: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
