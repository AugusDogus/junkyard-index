import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { vinplusCalendarDate, vinplusOptionalText } from "./vinplus-protocol";
import type { ChasencarsCatalog, ChasencarsRecord } from "./chasencars-parser";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import {
  CHASENCARS_CATALOG,
  CHASENCARS_MINIMUM_INVENTORY,
  CHASENCARS_YARD,
} from "./chasencars-yard-metadata";

export type ChasencarsVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "chasencars";
};
// Same native MM/DD/YY arrival format as Aero's inline CRUSH report.
// Observed arrivals are 2025/2026. Future or invalid calendar dates stay null.
export function chasencarsDate(value: string, updated: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value);
  const reference = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(updated);
  if (!match || !reference) return null;
  const arrived = vinplusCalendarDate(
    2000 + Number(match[3]),
    Number(match[1]),
    Number(match[2]),
  );
  const reported = vinplusCalendarDate(
    2000 + Number(reference[3]),
    Number(reference[1]),
    Number(reference[2]),
  );
  return arrived && reported && arrived <= reported ? arrived : null;
}
const key = (record: ChasencarsRecord) =>
  JSON.stringify([record.year, record.make, record.model]);
const requiredText = (raw: string) =>
  /^0+$/.test(raw.trim()) ? null : vinplusOptionalText(raw);
export function chasencarsSnapshot(
  catalog: ChasencarsCatalog,
  previousAcceptedCount: number | null,
) {
  const known = new Map<string, string>();
  for (const record of catalog.records) {
    const vin = inventoryVin(record.vin, record.year);
    if (vin) known.set(record.vin.trim().toUpperCase(), vin);
  }
  const groups = new Map<
    string,
    { required: Set<string>; stocks: Set<string> }
  >();
  for (const record of catalog.records) {
    const vin = known.get(record.vin.trim().toUpperCase());
    if (!vin) continue;
    const group = groups.get(vin) ?? {
      required: new Set<string>(),
      stocks: new Set<string>(),
    };
    group.required.add(key(record));
    const stock = vinplusOptionalText(record.stock);
    if (stock) group.stocks.add(stock);
    groups.set(vin, group);
  }
  const stockOwners = new Map<string, Set<string>>();
  for (const [vin, group] of groups)
    for (const stock of group.stocks)
      stockOwners.set(stock, new Set([...(stockOwners.get(stock) ?? []), vin]));
  const conflicts = new Set(
    [...groups]
      .filter(
        ([, group]) =>
          group.required.size > 1 ||
          group.stocks.size > 1 ||
          [...group.stocks].some(
            (stock) => (stockOwners.get(stock)?.size ?? 0) > 1,
          ),
      )
      .map(([vin]) => vin),
  );
  const vehicles = new Map<string, ChasencarsVehicle>();
  const observedVins = new Set<string>();
  const rejected: ChasencarsRecord[] = [];
  const accounting = {
    recordsProcessed: catalog.records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const record of catalog.records) {
    const vin = inventoryVin(record.vin, record.year),
      observed = known.get(record.vin.trim().toUpperCase());
    const year = /^\d{4}$/.test(record.year) ? Number(record.year) : null;
    const make = requiredText(record.make),
      model = requiredText(record.model);
    if (
      !vin ||
      year === null ||
      year < 1886 ||
      year > 2100 ||
      !make ||
      !model ||
      (observed && conflicts.has(observed))
    ) {
      accounting.recordsRejected++;
      rejected.push(record);
      if (observed) observedVins.add(observed);
      continue;
    }
    const optional = {
      color: vinplusOptionalText(record.color)
        ? normalizeCanonicalColor(record.color)
        : null,
      stockNumber: vinplusOptionalText(record.stock),
      row: /^0+$/.test(record.row) ? null : vinplusOptionalText(record.row),
      availableDate: chasencarsDate(record.arrived, catalog.updated),
      engine: vinplusOptionalText(record.engine),
    };
    const existing = vehicles.get(vin);
    if (existing) {
      accounting.duplicateVehicles++;
      for (const field of [
        "color",
        "stockNumber",
        "row",
        "availableDate",
        "engine",
      ] as const)
        if (existing[field] !== optional[field]) existing[field] = null;
      continue;
    }
    vehicles.set(vin, {
      source: "chasencars",
      vin,
      year,
      make: normalizeCanonicalMake(make),
      model,
      ...optional,
      imageUrl: null,
      locationCode: CHASENCARS_YARD.code,
      locationName: CHASENCARS_YARD.name,
      locationCity: CHASENCARS_YARD.city,
      state: "Oklahoma",
      stateAbbr: "OK",
      lat: CHASENCARS_YARD.lat,
      lng: CHASENCARS_YARD.lng,
      section: null,
      space: null,
      detailsUrl: CHASENCARS_CATALOG,
      partsUrl: null,
      pricesUrl: null,
      trim: null,
      transmission: null,
    });
  }
  const errors: string[] = [];
  if (vehicles.size < CHASENCARS_MINIMUM_INVENTORY)
    errors.push(
      `Chase N Cars accepted ${vehicles.size}, below fixed source floor220`,
    );
  if (
    accounting.recordsRejected / catalog.records.length >
    SourceValidationPolicy.maximumRejectionRatio
  )
    errors.push("Chase N Cars rejection ratio exceeds10%");
  if (
    accounting.duplicateVehicles / catalog.records.length >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    errors.push("Chase N Cars duplicate ratio exceeds25%");
  if (
    previousAcceptedCount !== null &&
    (!Number.isSafeInteger(previousAcceptedCount) ||
      previousAcceptedCount < 0 ||
      vehicles.size <
        Math.floor(
          previousAcceptedCount *
            SourceValidationPolicy.minimumPreviousRunRatio,
        ))
  )
    errors.push(
      "Chase N Cars inventory violates the previous-run50% drift limit",
    );
  if (
    vehicles.size +
      accounting.recordsRejected +
      accounting.duplicateVehicles !==
    catalog.records.length
  )
    errors.push("Chase N Cars whole-report accounting does not reconcile");
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    rejected,
    conflicts: [...conflicts].sort(),
    accounting,
    errors,
  };
}
