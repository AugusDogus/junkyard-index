import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { RustyhookRecord } from "./rustyhook-parser";
import { RUSTYHOOK_YARD } from "./rustyhook-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type RustyhookCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "rustyhook";
};
export type RustyhookVehicleResult =
  | { status: "available"; vehicle: RustyhookCanonicalVehicle }
  | {
      status: "rejected";
      reason:
        | "invalid_required_fields"
        | "conflicting_native_vin"
        | "inactive_donor";
      observedVins: string[];
    };

function optional(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  return !/[A-Z0-9]/i.test(value) ||
    /^(?:other|unknown|none|null|na|notavailable)$/.test(
      value.toLowerCase().replace(/[\s/_.-]+/g, ""),
    )
    ? null
    : value;
}
export function rustyhookRecordVins(record: RustyhookRecord): string[] {
  const fields = record.fields;
  const values = [
    fields.VIN ?? "",
    ...[
      ...(fields["Car Notes"] ?? "").matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/gi),
    ].map(([value]) => value),
  ];
  return [
    ...new Set(
      values.flatMap((value) => {
        const vin = inventoryVin(value, fields.Year ?? "");
        return vin ? [vin] : [];
      }),
    ),
  ];
}
export function transformRustyhookRecord(
  record: RustyhookRecord,
): RustyhookVehicleResult {
  const fields = record.fields;
  const observedVins = rustyhookRecordVins(record);
  const vin = inventoryVin(fields.VIN ?? "", fields.Year ?? "");
  if (observedVins.length > 1)
    return {
      status: "rejected",
      reason: "conflicting_native_vin",
      observedVins,
    };
  const year = fields.Year?.trim() ?? "";
  const make = optional(fields.Make);
  const model = optional(fields.Model);
  if (
    !vin ||
    !/^\d{4}$/.test(year) ||
    Number(year) <= 0 ||
    !make ||
    !model ||
    /^0+$/.test(make) ||
    /^0+$/.test(model) ||
    [year, make, model].join(" ") !== record.heading ||
    record.heading !== record.post.title
  )
    return {
      status: "rejected",
      reason: "invalid_required_fields",
      observedVins,
    };
  // Only explicit whole-donor removal signals apply. Specific sold components
  // and past-tense parting before testing do not remove catalog membership.
  if (
    /\b(?:whole\s+(?:vehicle|car|donor)\s+(?:is\s+)?sold|(?:vehicle|car|donor)\s+(?:(?:has\s+been|is|was)\s+)?(?:sold|scrapped|removed))\b/i.test(
      fields["Car Notes"] ?? "",
    )
  )
    return { status: "rejected", reason: "inactive_donor", observedVins };
  return {
    status: "available",
    vehicle: {
      source: "rustyhook",
      vin,
      year: Number(year),
      make: normalizeCanonicalMake(make),
      model,
      color: normalizeCanonicalColor(optional(fields["Exterior Color"])),
      stockNumber: optional(fields["Stock Number"]),
      imageUrl: record.images[0] ?? null,
      availableDate: null,
      locationCode: RUSTYHOOK_YARD.code,
      locationName: RUSTYHOOK_YARD.name,
      locationCity: RUSTYHOOK_YARD.city,
      state: "Pennsylvania",
      stateAbbr: "PA",
      lat: RUSTYHOOK_YARD.lat,
      lng: RUSTYHOOK_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: record.post.url,
      partsUrl: null,
      pricesUrl: null,
      engine: optional(fields.Engine),
      trim: null,
      transmission: optional(fields.Transmission),
    },
  };
}
