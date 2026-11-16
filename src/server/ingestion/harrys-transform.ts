import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { HarrysRecord } from "./harrys-parser";
import {
  HARRYS_YARDS,
  HARRYS_MINIMUM,
  HARRYS_MINIMUM_BY_YARD,
} from "./harrys-yard-metadata";
export type HarrysCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "harrys";
};
const usable = (v: string) =>
  v.length > 0 &&
  /[A-Z0-9]/i.test(v) &&
  !/^(?:unknown|other|n\/?a|null|none|undefined|[?*-]+)$/i.test(v);
function date(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) return null;
  const value = `${m[3]}-${m[1]}-${m[2]}`;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function harrysSnapshot(records: readonly HarrysRecord[]) {
  const vehicles = new Map<string, HarrysCanonicalVehicle>();
  const observedVins = new Set<string>();
  const rejectedIds = new Set<string>();
  const accounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  const claims = new Map<string, Set<string>>();
  for (const r of records) {
    const vin = inventoryVinWithCheckDigit(r.vin, r.year);
    if (vin) {
      const s = claims.get(vin) ?? new Set<string>();
      s.add(JSON.stringify([r.year, r.make, r.model, r.yard]));
      claims.set(vin, s);
    }
  }
  for (const r of records) {
    const vin = inventoryVinWithCheckDigit(r.vin, r.year);
    const year = Number(r.year);
    const yard = HARRYS_YARDS.find((y) => y.city.toUpperCase() === r.yard);
    if (
      !vin ||
      /^([A-Z0-9])\1+$/.test(vin) ||
      !/^\d{4}$/.test(r.year) ||
      // The feed uses 1901 for unknown years, including modern VINs.
      year === 1901 ||
      year < 1886 ||
      year > 2100 ||
      !usable(r.make) ||
      !usable(r.model) ||
      !yard ||
      (claims.get(vin)?.size ?? 0) > 1
    ) {
      accounting.recordsRejected++;
      rejectedIds.add(r.id);
      if (vin && yard) observedVins.add(vin);
      continue;
    }
    if (vehicles.has(vin)) {
      accounting.duplicateVehicles++;
      continue;
    }
    vehicles.set(vin, {
      source: "harrys",
      vin,
      year,
      make: normalizeCanonicalMake(r.make),
      model: r.model,
      color: usable(r.color) ? r.color : null,
      stockNumber: null,
      imageUrl: null,
      availableDate: date(r.date),
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      state: "Pennsylvania",
      stateAbbr: "PA",
      lat: yard.lat,
      lng: yard.lng,
      row: usable(r.row) ? r.row : null,
      section: null,
      space: null,
      // Import row IDs can be reassigned to another car on the next feed load.
      detailsUrl: null,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    });
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
    rejectedIds,
  };
}
export function validateHarrysSnapshot(
  snapshot: ReturnType<typeof harrysSnapshot>,
  records: readonly HarrysRecord[],
) {
  const { vehicles, accounting: a } = snapshot;
  if (
    vehicles.length < HARRYS_MINIMUM ||
    a.recordsRejected / a.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / a.recordsProcessed >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      `Harry's complete inventory failed its ${HARRYS_MINIMUM}-donor floor, 10% rejection or 25% duplicate guard`,
    );
  for (const yard of HARRYS_YARDS) {
    const rows = vehicles.filter((v) => v.locationCode === yard.code);
    const native = records.filter(
      (record) => record.yard === yard.city.toUpperCase(),
    );
    const yardRejected = native.filter((record) =>
      snapshot.rejectedIds.has(record.id),
    ).length;
    if (
      !a.recordsProcessed ||
      rows.length < (HARRYS_MINIMUM_BY_YARD.get(yard.code) ?? Infinity) ||
      (native.length > 0 &&
        yardRejected / native.length >
          SourceValidationPolicy.maximumRejectionRatio)
    )
      throw new Error(
        "Harry's physical yard floor or 10% rejection guard failed: " +
          yard.code,
      );
  }
}
