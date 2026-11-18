import { tritownVehiclePhoto } from "./vehicle-photo";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { TritownRecord } from "./tritown-parser";
import type { CanonicalVehicle } from "./types";
import { TRITOWN_YARD } from "./tritown-yard-metadata";

export type TritownCanonicalVehicle = CanonicalVehicle & { source: "tritown" };
const aliases = new Map([
  ["Chevy", "Chevrolet"],
  ["VW", "Volkswagen"],
  ["Mercedes", "Mercedes-Benz"],
]);

export function transformTritownRecord(
  record: TritownRecord,
  nativeMakes: readonly string[],
):
  | { status: "available"; vehicle: TritownCanonicalVehicle }
  | { status: "incomplete"; vin: string | null } {
  const title = /^(\d{4})\s+(.+)$/.exec(record.title);
  const year = title?.[1] ?? "";
  const remainder = title?.[2] ?? "";
  const vin = inventoryVin(record.vin, year);
  const prefix = [...nativeMakes, ...aliases.keys()]
    .sort((a, b) => b.length - a.length)
    .find((make) => remainder.startsWith(make + " "));
  const nativeMake = prefix ? (aliases.get(prefix) ?? prefix) : "";
  const make = normalizeCanonicalMake(nativeMake);
  const model = prefix ? remainder.slice(prefix.length).trim() : "";
  if (
    !vin ||
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !nativeMake ||
    !nativeMakes.includes(nativeMake) ||
    /^(?:other|unknown)$/i.test(make) ||
    !model ||
    /^(?:other|unknown|n\/?a)$/i.test(model) ||
    // WordPress can retain a trashed post in its listing response. Its VIN is
    // presence evidence, but that destination cannot prove an active donor.
    !/^https:\/\/tritownautosalvage\.com\/vehicle\/[a-z0-9-]+\/$/.test(
      record.donorUrl,
    )
  )
    return { status: "incomplete", vin };
  const position =
    /^Row\s+(.+?)\s+Vin\b/i.exec(record.description)?.[1]?.trim() ?? null;
  return {
    status: "available",
    vehicle: {
      source: "tritown",
      vin,
      year: Number(year),
      make,
      model,
      locationCode: TRITOWN_YARD.code,
      locationName: TRITOWN_YARD.name,
      locationCity: TRITOWN_YARD.city,
      state: "Pennsylvania",
      stateAbbr: "PA",
      lat: TRITOWN_YARD.lat,
      lng: TRITOWN_YARD.lng,
      detailsUrl: record.donorUrl,
      // Posted timestamps and CMS IDs are not donor arrival dates or yard stocks.
      availableDate: null,
      stockNumber: null,
      color: null,
      imageUrl: tritownVehiclePhoto(record.imageUrl),
      row: position,
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
