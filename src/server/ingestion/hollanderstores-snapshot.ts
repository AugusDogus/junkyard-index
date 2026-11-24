import { hollanderVehiclePhoto } from "./vehicle-photo";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake, normalizeRegion } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { HollanderstoresPage } from "./hollanderstores-parser";
import type { HollanderstoresPreservedYard } from "./hollanderstores-cursor";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
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
function decodedMake(value: string | null | undefined, vin: string) {
  if (!required(value)) return null;
  if (value?.trim().toUpperCase() === "SPRINTER (DODGE OR FREIGHTLINER)") {
    // NHTSA DecodeWMI lists Freightliner as WD2's concrete make, alongside
    // this ambiguous model family. Prefer that real make when no native make
    // is available. Other WMIs need independent qualification.
    return vin.startsWith("WD2") ? "FREIGHTLINER" : null;
  }
  return value ?? null;
}
/** Keeps a yard's reason within the checkpoint's bound. */
export const hollanderstoresPreservedReason = (reason: string) =>
  reason.length <= 4_000 ? reason : reason.slice(0, 3_999) + "…";

/**
 * Builds the publishable inventory yard by yard. A yard in `preserved` (its
 * closing census drifted) or one failing its own floor, rejection or
 * duplicate guard contributes nothing and is listed in `rejectedYards`, so
 * its previously published inventory stays. `errors` holds only failures of
 * the whole source.
 */
export function hollanderstoresSnapshot(
  pages: readonly HollanderstoresPage[],
  decoded: Readonly<Record<string, string | null>>,
  previousAcceptedCount: number | null = null,
  preserved: ReadonlySet<string> = new Set(),
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
  const rejectedYards: HollanderstoresPreservedYard[] = [];
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
  for (const yard of HOLLANDERSTORES_YARDS) {
    const page = pages.find((page) => page.yard === yard.code);
    if (!page) {
      errors.push("Missing complete yard " + yard.code);
      continue;
    }
    // Rows of a yard that publishes nothing are read but excluded.
    const exclude = () => {
      accounting.recordsProcessed += page.rows.length;
      accounting.recordsExcluded += page.rows.length;
    };
    if (preserved.has(yard.code)) {
      exclude();
      continue;
    }
    const tally = {
      code: yard.code,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      total: page.total,
    };
    // A yard commits its rows, observations and warnings only once it
    // passes its own guards.
    const yardVehicles = new Map<string, HollanderstoresVehicle>();
    const yardObserved: string[] = [];
    const yardWarnings: string[] = [];
    for (const row of page.rows) {
      const identity = inventoryVin(row.vin, "");
      const vin = hollanderstoresVin(row.vin),
        year = hollanderstoresYear(row.displayYear);
      const native = required(row.make) ? row.make : null;
      const lookup = vin ? decodedMake(decoded[vin], vin) : null;
      const make = native ?? (required(lookup) ? lookup : null);
      if (
        native &&
        lookup &&
        hollanderstoresMake(native) !== hollanderstoresMake(lookup)
      )
        yardWarnings.push(
          `${yard.name} VIN ${row.vin}: published make ${native} conflicts with NHTSA ${lookup}; published make retained.`,
        );
      if (
        !vin ||
        year === null ||
        !make ||
        !required(row.model) ||
        conflicts.has(vin)
      ) {
        tally.rejected++;
        if (identity) yardObserved.push(identity);
        continue;
      }
      if (vehicles.has(vin) || yardVehicles.has(vin)) {
        tally.duplicates++;
        continue;
      }
      const region = normalizeRegion(yard.state);
      yardVehicles.set(vin, {
        source: "hollanderstores",
        vin,
        year,
        make: hollanderstoresMake(make),
        model: row.model,
        stockNumber: required(row.stock) ? row.stock : null,
        color: null,
        imageUrl: hollanderVehiclePhoto(row.imageUrl),
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
    const yardErrors: string[] = [];
    if (tally.accepted < yard.minimum)
      yardErrors.push(
        `${yard.name} accepted ${tally.accepted}; minimum ${yard.minimum}`,
      );
    if (
      tally.rejected / tally.total >
      SourceValidationPolicy.maximumRejectionRatio
    )
      yardErrors.push(`${yard.name} rejection ratio exceeds 10%`);
    if (
      tally.duplicates / tally.total >
      SourceValidationPolicy.maximumDuplicateRatio
    )
      yardErrors.push(`${yard.name} duplicate ratio exceeds 25%`);
    perYard.push(tally);
    if (yardErrors.length) {
      rejectedYards.push({
        code: yard.code,
        reason: hollanderstoresPreservedReason(
          `${yardErrors.join("; ")} (${yard.code}: ${tally.accepted} accepted, ${tally.rejected} rejected, ${tally.duplicates} duplicates of ${tally.total} listed). This yard publishes nothing this run and its previously published inventory is preserved; the next daily crawl checks it again.`,
        ),
      });
      exclude();
      continue;
    }
    for (const [vin, vehicle] of yardVehicles) vehicles.set(vin, vehicle);
    for (const vin of yardObserved) observedVins.add(vin);
    warnings.push(...yardWarnings);
    accounting.recordsProcessed += page.rows.length;
    accounting.recordsRejected += tally.rejected;
    accounting.duplicateVehicles += tally.duplicates;
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
    rejectedYards,
    warnings,
    errors,
  };
}
