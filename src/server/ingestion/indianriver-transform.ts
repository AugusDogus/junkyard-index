import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { IndianriverPage, IndianriverRecord } from "./indianriver-parser";
import {
  INDIANRIVER_CATALOG,
  INDIANRIVER_MINIMUM_UNIQUE_INVENTORY,
  INDIANRIVER_PAGE_SIZE,
  INDIANRIVER_YARD,
} from "./indianriver-yard-metadata";

export type IndianriverCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "indianriver";
};
const usable = (v: string) =>
  v.length > 0 &&
  v.length <= 200 &&
  /[A-Z0-9]/i.test(v) &&
  !/^(?:unknown|other|n\/?a|null|none|undefined)$/i.test(v);
function date(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) return null;
  const value = `${m[3]}-${m[1]}-${m[2]}`;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function transformIndianriverRecord(
  record: IndianriverRecord,
):
  | { status: "available"; vehicle: IndianriverCanonicalVehicle }
  | { status: "rejected"; observedVins: string[]; reasons: string[] } {
  const vin = inventoryVin(record.vin, record.year);
  const year = /^\d{4}$/.test(record.year) ? Number(record.year) : 0;
  const reasons: string[] = [];
  if (!vin) reasons.push("missing-or-invalid-vin-or-older-serial");
  if (year < 1886 || year > 2100) reasons.push("missing-or-invalid-year");
  if (!usable(record.make) || !usable(record.model))
    reasons.push("missing-or-invalid-make-model");
  if (!vin || reasons.length)
    return { status: "rejected", reasons, observedVins: vin ? [vin] : [] };
  return {
    status: "available",
    vehicle: {
      source: "indianriver",
      vin,
      year,
      make: normalizeCanonicalMake(record.make),
      model: record.model,
      color: null,
      stockNumber: null,
      imageUrl: null,
      availableDate: date(record.arrivalDate),
      locationCode: INDIANRIVER_YARD.code,
      locationName: INDIANRIVER_YARD.name,
      locationCity: INDIANRIVER_YARD.city,
      state: "Florida",
      stateAbbr: "FL",
      lat: INDIANRIVER_YARD.lat,
      lng: INDIANRIVER_YARD.lng,
      row: null,
      section: null,
      space: null,
      // Native donor links reuse paperwork slugs such as title- across many VINs.
      // The complete searchable inventory is the usable source destination.
      detailsUrl: INDIANRIVER_CATALOG,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}

export function indianriverSnapshot(pages: readonly IndianriverPage[]) {
  const first = pages[0];
  if (
    !first ||
    pages.length !== Math.ceil(first.total / INDIANRIVER_PAGE_SIZE) ||
    pages.some(
      (p, index) =>
        p.index !== index ||
        p.total !== first.total ||
        p.records.length !==
          Math.min(
            INDIANRIVER_PAGE_SIZE,
            first.total - index * INDIANRIVER_PAGE_SIZE,
          ),
    )
  )
    throw new Error(
      "Indian River census is incomplete, reordered or has inconsistent totals",
    );
  const records = pages.flatMap((p) => p.records);
  if (
    records.length !== first.total ||
    new Set(records.map((r) => r.id)).size !== records.length
  )
    throw new Error(
      "Indian River native traversal IDs or total do not reconcile across all pages",
    );
  const claims = new Map<
    string,
    { year: Set<string>; make: Set<string>; model: Set<string> }
  >();
  for (const record of records) {
    const vin = inventoryVin(record.vin, record.year);
    if (!vin) continue;
    const values = claims.get(vin) ?? {
      year: new Set<string>(),
      make: new Set<string>(),
      model: new Set<string>(),
    };
    for (const key of ["year", "make", "model"] as const)
      if (record[key]) values[key].add(record[key]);
    claims.set(vin, values);
  }
  const conflictingVins = new Set(
    [...claims]
      .filter(([, v]) => Object.values(v).some((s) => s.size > 1))
      .map(([vin]) => vin),
  );
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, IndianriverCanonicalVehicle>();
  const dates = new Map<string, Set<string>>();
  const observedVins = new Set<string>();
  const rejected: { id: string; reasons: string[] }[] = [];
  for (const record of records) {
    const vin = inventoryVin(record.vin, record.year);
    const result = transformIndianriverRecord(record);
    if ((vin && conflictingVins.has(vin)) || result.status === "rejected") {
      accounting.recordsRejected++;
      if (vin) observedVins.add(vin);
      rejected.push({
        id: record.id,
        reasons: [
          ...(result.status === "rejected" ? result.reasons : []),
          ...(vin && conflictingVins.has(vin)
            ? ["conflicting-native-required-identity"]
            : []),
        ],
      });
      continue;
    }
    const vehicle = result.vehicle;
    const values = dates.get(vehicle.vin) ?? new Set<string>();
    if (vehicle.availableDate) values.add(vehicle.availableDate);
    dates.set(vehicle.vin, values);
    if (vehicles.has(vehicle.vin)) accounting.duplicateVehicles++;
    else vehicles.set(vehicle.vin, vehicle);
  }
  for (const [vin, vehicle] of vehicles) {
    const values = dates.get(vin);
    vehicle.availableDate =
      values?.size === 1 ? ([...values][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    accounting,
    observedVins: [...observedVins].sort(),
    rejected,
    conflictingVins: [...conflictingVins].sort(),
  };
}
export function validateIndianriverSnapshot(
  snapshot: ReturnType<typeof indianriverSnapshot>,
  previous: number | null,
): void {
  const { accounting: a, vehicles } = snapshot;
  if (previous !== null && (!Number.isSafeInteger(previous) || previous < 0))
    throw new Error(
      "Indian River previous complete count must be null or a nonnegative integer",
    );
  if (
    a.recordsProcessed !==
      vehicles.length + a.recordsRejected + a.duplicateVehicles ||
    a.recordsExcluded !== 0 ||
    vehicles.length < INDIANRIVER_MINIMUM_UNIQUE_INVENTORY ||
    a.recordsRejected / a.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / a.recordsProcessed >
      SourceValidationPolicy.maximumDuplicateRatio ||
    (previous !== null &&
      vehicles.length <
        previous * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    throw new Error(
      "Indian River complete census failed reconciliation, the 349-donor floor, 10% rejection, 25% duplicate or 50% previous-count guard; prior inventory is preserved",
    );
}
