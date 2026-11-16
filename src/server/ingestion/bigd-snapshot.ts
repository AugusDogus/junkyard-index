import type { BigdRecord } from "./bigd-parser";
import { BIGD_MINIMUM_INVENTORY, BIGD_YARD } from "./bigd-yard-metadata";
import { inventoryVin } from "./inventory-vin";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
export type BigdVehicle = CanonicalVehicle & { source: "bigd" };

export function bigdSnapshot(
  rows: readonly BigdRecord[],
  previous: number | null,
) {
  const signatures = new Map<string, Set<string>>();
  for (const row of rows) {
    const vin = inventoryVin(row.vin, row.year);
    if (vin)
      signatures.set(
        vin,
        new Set([...(signatures.get(vin) ?? []), JSON.stringify(row)]),
      );
  }
  const conflicts = new Set(
    [...signatures].filter(([, values]) => values.size > 1).map(([vin]) => vin),
  );
  const vehicles = new Map<string, BigdVehicle>();
  const observedVins = new Set<string>();
  const accounting = {
    recordsProcessed: rows.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const unknown = /^(?:unknown|other|n\/?a|none|null|undefined|[-?]+)$/i;
  for (const row of rows) {
    const observed = inventoryVin(row.vin, row.year);
    const vin = inventoryVinWithCheckDigit(row.vin, row.year);
    const make = normalizeCanonicalMake(row.make),
      model = row.model.trim();
    if (observed) observedVins.add(observed);
    if (
      !vin ||
      (observed && conflicts.has(observed)) ||
      !/^\d{4}$/.test(row.year) ||
      Number(row.year) < 1886 ||
      Number(row.year) > 2100 ||
      !make ||
      !model ||
      unknown.test(make) ||
      unknown.test(model)
    ) {
      accounting.recordsRejected++;
      continue;
    }
    if (vehicles.has(vin)) {
      accounting.duplicateVehicles++;
      continue;
    }
    vehicles.set(vin, {
      source: "bigd",
      vin,
      year: Number(row.year),
      make,
      model,
      color:
        /^[a-z]+(?:[ /-][a-z]+)*$/i.test(row.color) && !unknown.test(row.color)
          ? normalizeCanonicalColor(row.color)
          : null,
      row: /^\d{1,4}$/.test(row.row) ? row.row : null,
      // No native stock, per-vehicle link or photographs. Two-digit arrival
      // dates do not establish a century or timezone.
      stockNumber: null,
      availableDate: null,
      imageUrl: null,
      detailsUrl: null,
      locationCode: BIGD_YARD.code,
      locationName: BIGD_YARD.name,
      locationCity: BIGD_YARD.city,
      state: "Idaho",
      stateAbbr: "ID",
      lat: BIGD_YARD.lat,
      lng: BIGD_YARD.lng,
      partsUrl: null,
      pricesUrl: null,
      section: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
    });
  }
  if (
    (previous !== null && (!Number.isSafeInteger(previous) || previous < 0)) ||
    vehicles.size < BIGD_MINIMUM_INVENTORY ||
    accounting.recordsRejected / rows.length >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / rows.length >
      SourceValidationPolicy.maximumDuplicateRatio ||
    (previous !== null &&
      vehicles.size < previous * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    throw new Error(
      `Big D complete table failed the 250-donor floor, 10% rejection, 25% duplicate or 50% previous-count guard (${vehicles.size} accepted, ${accounting.recordsRejected} rejected). Prior inventory is preserved; inspect the native census before restarting.`,
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
  };
}
