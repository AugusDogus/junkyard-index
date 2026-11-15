import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { BeaversRecord } from "./beavers-parser";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import {
  BEAVERS_MINIMUM_INVENTORY,
  BEAVERS_YARD,
} from "./beavers-yard-metadata";

export type BeaversVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "beavers";
};
export function beaversYear(
  value: string,
  currentYear = new Date().getUTCFullYear(),
): number | null {
  if (!/^'\d{2}$/.test(value)) return null;
  const suffix = Number(value.slice(1));
  // Official parts site explicitly scopes its inventory to 1985 onward.
  const years = [1900 + suffix, 2000 + suffix].filter(
    (year) => year >= 1985 && year <= currentYear + 1,
  );
  return years.length === 1 ? (years[0] ?? null) : null;
}
const required = (value: string | null) =>
  value !== null &&
  value.trim() !== "" &&
  !/^(?:unknown|none|other|null|n\/?a|0+)$/i.test(value.trim());
export function beaversSnapshot(
  records: readonly BeaversRecord[],
  previousAcceptedCount: number | null = null,
  minimum = BEAVERS_MINIMUM_INVENTORY,
) {
  const groups = new Map<string, Set<string>>();
  const claims = records.map((record) => {
    const year = beaversYear(record.displayYear);
    const vins = [
      ...new Set(
        [record.vin, record.row.vin].flatMap((value) => {
          const vin = inventoryVin(value, year === null ? "" : String(year));
          return vin ? [vin] : [];
        }),
      ),
    ];
    const signature = JSON.stringify([
      record.displayYear,
      record.make,
      record.model,
      record.stock,
      record.url,
    ]);
    for (const vin of vins)
      groups.set(vin, new Set([...(groups.get(vin) ?? []), signature]));
    return { record, year, vins };
  });
  const conflicts = new Set(
    [...groups].filter(([, values]) => values.size > 1).map(([vin]) => vin),
  );
  const vehicles = new Map<string, BeaversVehicle>();
  const observedVins = new Set<string>();
  const accounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const { record, year, vins } of claims) {
    const vin = vins[0];
    if (record.inactive) {
      accounting.recordsExcluded++;
      continue;
    }
    if (
      !vin ||
      vins.length !== 1 ||
      vins.some((value) => conflicts.has(value)) ||
      year === null ||
      !required(record.make) ||
      !required(record.model) ||
      record.displayYear !== record.row.displayYear ||
      record.model !== record.row.model ||
      record.vin !== record.row.vin ||
      (required(record.stock) &&
        required(record.row.stock) &&
        record.stock !== record.row.stock)
    ) {
      accounting.recordsRejected++;
      for (const value of vins) observedVins.add(value);
      continue;
    }
    if (vehicles.has(vin)) {
      accounting.duplicateVehicles++;
      continue;
    }
    vehicles.set(vin, {
      source: "beavers",
      vin,
      year,
      make: normalizeCanonicalMake(record.make ?? ""),
      model: record.model,
      stockNumber:
        required(record.stock) && record.stock === record.row.stock
          ? record.stock.trim()
          : null,
      color: null,
      imageUrl: null,
      availableDate: null,
      locationCode: BEAVERS_YARD.code,
      locationName: BEAVERS_YARD.name,
      locationCity: BEAVERS_YARD.city,
      state: "North Carolina",
      stateAbbr: "NC",
      lat: BEAVERS_YARD.lat,
      lng: BEAVERS_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: record.url,
      partsUrl: record.url,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    });
  }
  const total = records.length - accounting.recordsExcluded;
  const errors: string[] = [];
  if (!Number.isSafeInteger(minimum) || minimum <= 0 || vehicles.size < minimum)
    errors.push(
      `Beaver's accepted ${vehicles.size} donors, minimum ${minimum}`,
    );
  if (
    vehicles.size +
      accounting.recordsRejected +
      accounting.duplicateVehicles !==
    total
  )
    errors.push("Beaver's donor accounting does not reconcile");
  if (
    total &&
    accounting.recordsRejected / total >
      SourceValidationPolicy.maximumRejectionRatio
  )
    errors.push("Beaver's required rejection ratio exceeds 10%");
  if (
    total &&
    accounting.duplicateVehicles / total >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    errors.push("Beaver's duplicate ratio exceeds 25%");
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
      "Beaver's accepted inventory fell below the previous-run 50% drift limit",
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
    conflicts: [...conflicts],
    errors,
  };
}
