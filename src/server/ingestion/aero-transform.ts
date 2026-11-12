import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { AeroRecord } from "./aero-parser";
import {
  AERO_INVENTORY_URL,
  AERO_ORIGIN,
  AERO_YARD,
} from "./aero-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type AeroCanonicalVehicle = CanonicalVehicle & { source: "aero" };
export type AeroVehicleResult =
  | { status: "available"; vehicle: AeroCanonicalVehicle }
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
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(raw);
  if (!match) return null;
  // This native feed uses 20xx arrival dates, never a guessed crawl timestamp.
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

export function parseAeroStockNumber(raw: string): string | null {
  return /^STK\d{6}$/.test(raw) ? raw : null;
}

export function transformAeroRecord(record: AeroRecord): AeroVehicleResult {
  const vin = inventoryVin(record.vin, record.year);
  const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  const color = normalizeCanonicalColor(record.color);
  const availableDate = sourceDate(record.arrived);
  const stockNumber = parseAeroStockNumber(record.stock);
  // Use only published links and match usable stock when present. A photo's
  // filename never supplies a missing stock number.
  const imageUrl =
    record.images.flatMap((raw) => {
      const url = URL.parse(raw, AERO_ORIGIN);
      const photoStock = url
        ? /^\/inventoryphotos\/(STK\d{6})(?:-[A-D])?\.jpe?g$/.exec(
            url.pathname,
          )?.[1]
        : undefined;
      return url &&
        url.origin === AERO_ORIGIN &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        photoStock &&
        (stockNumber === null || photoStock === stockNumber)
        ? [url.href]
        : [];
    })[0] ?? null;
  // Native STK007105 describes BMW BELAIR. Quarantine this unresolved source
  // description, never infer a replacement from the VIN or photo.
  const inconsistentModel = make === "BMW" && /^bel\s*air$/i.test(model);
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !make ||
    /^(?:other|unknown)$/i.test(make) ||
    !model ||
    /^(?:other|unknown)$/i.test(model) ||
    inconsistentModel
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "aero",
      vin,
      year,
      make,
      model,
      color: color && colors.has(color) ? color : null,
      availableDate,
      imageUrl,
      stockNumber,
      row: /^[1-9]\d*$/.test(record.row) ? record.row : null,
      detailsUrl: AERO_INVENTORY_URL,
      locationCode: AERO_YARD.code,
      locationName: AERO_YARD.name,
      locationCity: AERO_YARD.city,
      state: "Louisiana",
      stateAbbr: "LA",
      lat: AERO_YARD.lat,
      lng: AERO_YARD.lng,
      section: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      engine: record.engine.trim() || null,
      trim: null,
      transmission: null,
    },
  };
}
