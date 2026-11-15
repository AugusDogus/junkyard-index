import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake, normalizeRegion } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { HollanderstoresPage } from "./hollanderstores-parser";
import {
  HOLLANDERSTORES_YARDS,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";
import { hollanderstoresVin } from "./hollanderstores-vin";

export type HollanderstoresVehicle = CanonicalVehicle & {
  source: "hollanderstores";
};
export function hollanderstoresYear(
  value: string,
  currentYear = new Date().getUTCFullYear(),
): number | null {
  if (!/^'\d{2}$/.test(value)) return null;
  const suffix = Number(value.slice(1));
  // All possible centuries under the canonical vehicle-year contract.
  const candidates = [1800 + suffix, 1900 + suffix, 2000 + suffix].filter(
    (year) => year >= 1886 && year <= currentYear + 1,
  );
  // These native rosters use modern Hollander codes. Use the latest valid century.
  return candidates.at(-1) ?? null;
}
export const hollanderstoresMake = (value: string) =>
  normalizeCanonicalMake(value.replace(/^ALFA-ROMEO$/i, "Alfa Romeo"));
const required = (value: string | null | undefined) =>
  !!value?.trim() &&
  !/^(?:unknown|none|other|null|n\/?a|0+)$/i.test(value.trim());
export function hollanderstoresSnapshot(
  pages: readonly HollanderstoresPage[],
  decoded: Readonly<Record<string, string | null>>,
  previousAcceptedCount: number | null = null,
  yards: readonly HollanderstoresYard[] = HOLLANDERSTORES_YARDS,
) {
  const vehicles = new Map<string, HollanderstoresVehicle>();
  const claims = new Map<string, Set<string>>();
  for (const page of pages)
    for (const row of page.rows) {
      const vin = inventoryVin(row.vin, "");
      if (vin)
        claims.set(
          vin,
          new Set([
            ...(claims.get(vin) ?? []),
            JSON.stringify([page.yard, row]),
          ]),
        );
    }
  const conflicts = new Set(
    [...claims].filter(([, values]) => values.size > 1).map(([vin]) => vin),
  );
  const observedVins = new Set<string>();
  const warnings: string[] = [],
    errors: string[] = [];
  const perYard: {
    code: string;
    accepted: number;
    rejected: number;
    duplicates: number;
    total: number;
  }[] = [];
  const accounting = {
    recordsProcessed: 0,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const yard of yards) {
    const page = pages.find((page) => page.yard === yard.code);
    if (!page) {
      errors.push("Missing complete yard " + yard.code);
      continue;
    }
    const tally = {
      code: yard.code,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      total: page.total,
    };
    for (const row of page.rows) {
      accounting.recordsProcessed++;
      const identity = inventoryVin(row.vin, "");
      const vin = hollanderstoresVin(row.vin),
        year = hollanderstoresYear(row.displayYear);
      const native = required(row.make) ? row.make : null;
      const lookup = vin ? decoded[vin] : null;
      const make = native ?? (required(lookup) ? lookup : null);
      if (
        native &&
        lookup &&
        hollanderstoresMake(native) !== hollanderstoresMake(lookup)
      )
        warnings.push(
          `${yard.name} VIN ${row.vin}: published make ${native} conflicts with NHTSA ${lookup}; published make retained.`,
        );
      if (
        !vin ||
        year === null ||
        !make ||
        !required(row.model) ||
        conflicts.has(vin)
      ) {
        accounting.recordsRejected++;
        tally.rejected++;
        if (identity) observedVins.add(identity);
        continue;
      }
      if (vehicles.has(vin)) {
        accounting.duplicateVehicles++;
        tally.duplicates++;
        continue;
      }
      const region = normalizeRegion(yard.state);
      vehicles.set(vin, {
        source: "hollanderstores",
        vin,
        year,
        make: hollanderstoresMake(make),
        model: row.model,
        stockNumber: required(row.stock) ? row.stock : null,
        color: null,
        imageUrl: null,
        availableDate: null,
        locationCode: yard.code,
        locationName: yard.name,
        locationCity: yard.city,
        state: region.state,
        stateAbbr: yard.state,
        lat: yard.lat,
        lng: yard.lng,
        section: null,
        row: null,
        space: null,
        detailsUrl: row.url,
        partsUrl: row.url,
        pricesUrl: null,
        engine: null,
        trim: null,
        transmission: null,
      });
      tally.accepted++;
    }
    if (tally.accepted < yard.minimum)
      errors.push(
        `${yard.name} accepted ${tally.accepted}; minimum ${yard.minimum}`,
      );
    if (
      tally.rejected / tally.total >
      SourceValidationPolicy.maximumRejectionRatio
    )
      errors.push(`${yard.name} rejection ratio exceeds 10%`);
    if (
      tally.duplicates / tally.total >
      SourceValidationPolicy.maximumDuplicateRatio
    )
      errors.push(`${yard.name} duplicate ratio exceeds 25%`);
    perYard.push(tally);
  }
  if (
    previousAcceptedCount !== null &&
    vehicles.size <
      Math.floor(
        previousAcceptedCount * SourceValidationPolicy.minimumPreviousRunRatio,
      )
  )
    errors.push(
      "Hollander Stores inventory fell below the previous-run 50% drift limit",
    );
  if (accounting.recordsRejected)
    warnings.push(
      `Hollander Stores rejected ${accounting.recordsRejected} rows; valid rejected VIN identities protect previous inventory.`,
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
    perYard,
    warnings,
    errors,
  };
}
