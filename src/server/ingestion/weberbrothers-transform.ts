import { inventoryVin } from "~/server/ingestion/inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "~/server/ingestion/normalization";
import type { CanonicalVehicle } from "~/server/ingestion/types";
import {
  weberbrothersImageBound,
  type WeberbrothersRecord,
} from "./weberbrothers-parser";
import { WEBERBROTHERS_YARD } from "./weberbrothers-yard-metadata";

export type WeberbrothersCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "weberbrothers";
};
export type WeberbrothersAssessment =
  | { status: "available"; vehicle: WeberbrothersCanonicalVehicle }
  | {
      status: "rejected";
      reason:
        | "invalid_required_identity"
        | "conflicting_native_vin"
        | "inactive_donor";
      observedVins: string[];
    };

// Explicit native make words only. These include the independently captured
// native selector names and real historical brands. No model-to-make inference
// or spelling repair. Display aliases express the same published make.
const makes = [
  "ACURA",
  "ALFA ROMEO",
  "AUDI",
  "BMW",
  "BUICK",
  "CADILLAC",
  "CHEVROLET",
  "CHRYSLER",
  "DODGE",
  "FIAT",
  "FORD",
  "GENESIS",
  "GMC",
  "HINO",
  "HONDA",
  "HUMMER",
  "HYUNDAI",
  "INFINITI",
  "ISUZU",
  "JAGUAR",
  "JEEP",
  "KIA",
  "LAND ROVER",
  "LANDROVER",
  "LEXUS",
  "LINCOLN",
  "MASERATI",
  "MAZDA",
  "MERCEDES-BENZ",
  "MERCEDES BENZ",
  "MERCEDES",
  "MINI",
  "MITSUBISHI",
  "NISSAN",
  "POLESTAR",
  "PORSCHE",
  "RAM",
  "SATURN",
  "SCION",
  "SUBARU",
  "SUZUKI",
  "TESLA",
  "TOYOTA",
  "VOLKSWAGEN",
  "VOLVO",
  "WAGONEER",
  "CHEVY",
  "VW",
].sort((a, b) => b.length - a.length);
const aliases = new Map([
  ["MERCEDES BENZ", "Mercedes-Benz"],
  ["MERCEDES", "Mercedes-Benz"],
  ["LANDROVER", "Land Rover"],
  ["CHEVY", "Chevrolet"],
  ["VW", "Volkswagen"],
]);
export function weberbrothersIdentity(heading: string) {
  const match = /^(\d{4})\s+(.+)$/.exec(heading.trim());
  const year = Number(match?.[1]);
  const rest = match?.[2]?.toUpperCase() ?? "";
  const nativeMake = makes.find((make) => rest.startsWith(make + " "));
  const model = nativeMake ? rest.slice(nativeMake.length).trim() : "";
  return year >= 1886 && year <= 2100 && nativeMake && /[A-Z0-9]/.test(model)
    ? {
        year,
        make: aliases.get(nativeMake) ?? normalizeCanonicalMake(nativeMake),
        model,
      }
    : null;
}
function optional(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  return !/[A-Z0-9]/i.test(value) ||
    /^(?:other|unknown|none|null|na|notavailable)$/.test(
      value.toLowerCase().replace(/[\s/_.-]+/g, ""),
    )
    ? null
    : value;
}
export function weberbrothersRecordVins(record: WeberbrothersRecord): string[] {
  const nativeYear = /^(\d{4})\s/.exec(record.heading)?.[1] ?? "";
  const claims = [
    record.fields.VIN ?? "",
    ...[
      ...(record.fields.Comments ?? "").matchAll(
        /\bVIN\s*[:#]\s*([A-Z0-9]{5,17})\b/gi,
      ),
    ].map((match) => match[1] ?? ""),
  ];
  return [
    ...new Set(
      claims.flatMap((value) => {
        const vin = inventoryVin(value, nativeYear);
        return vin ? [vin] : [];
      }),
    ),
  ];
}
function arrival(raw: string | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw?.trim() ?? "");
  if (!match) return null;
  const iso = `${match[3]}-${match[1]}-${match[2]}`;
  const date = new Date(iso + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}
export function transformWeberbrothersRecord(
  record: WeberbrothersRecord,
): WeberbrothersAssessment {
  const observedVins = weberbrothersRecordVins(record);
  const identity = weberbrothersIdentity(record.heading);
  const nativeYear = /^(\d{4})\s/.exec(record.heading)?.[1] ?? "";
  const vin = inventoryVin(record.fields.VIN ?? "", nativeYear);
  if (observedVins.length > 1)
    return {
      status: "rejected",
      reason: "conflicting_native_vin",
      observedVins,
    };
  if (!identity || !vin)
    return {
      status: "rejected",
      reason: "invalid_required_identity",
      observedVins,
    };
  if (
    /\b(?:whole\s+(?:vehicle|car|donor)\s+(?:is\s+)?sold|(?:vehicle|car|donor)\s+(?:(?:has\s+been|is|was)\s+)?(?:sold|scrapped|removed))\b/i.test(
      record.fields.Comments ?? "",
    )
  )
    return { status: "rejected", reason: "inactive_donor", observedVins };
  return {
    status: "available",
    vehicle: {
      source: "weberbrothers",
      vin,
      ...identity,
      color: normalizeCanonicalColor(optional(record.fields["Exterior Color"])),
      stockNumber: optional(record.stock),
      imageUrl:
        record.images.find((image) =>
          weberbrothersImageBound(image, record.stock),
        ) ?? null,
      availableDate: arrival(record.fields["Arrival Date"]),
      locationCode: WEBERBROTHERS_YARD.code,
      locationName: WEBERBROTHERS_YARD.name,
      locationCity: WEBERBROTHERS_YARD.city,
      state: "Pennsylvania",
      stateAbbr: "PA",
      lat: WEBERBROTHERS_YARD.lat,
      lng: WEBERBROTHERS_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: record.post.url,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
