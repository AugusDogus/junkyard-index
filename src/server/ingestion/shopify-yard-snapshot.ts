import type { Yard } from "~/lib/yard";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import { shopifyYardHash, type ShopifyYardDonor } from "./shopify-yard-cursor";
import type { CanonicalVehicle } from "./types";

export function shopifyYardSnapshot(
  rows: readonly ShopifyYardDonor[],
  yard: Yard & { lat: number; lng: number },
  state: string,
  minimum: number,
  previous: number | null,
) {
  const assessments = rows.map((row) => {
    const vin = inventoryVin(row.vin, row.year);
    const reasons = [...row.reasons];
    if (!vin) reasons.push("missing-or-invalid-native-identity");
    if (
      !/^\d{4}$/.test(row.year) ||
      Number(row.year) < 1886 ||
      Number(row.year) > 2100 ||
      !/[a-z]/i.test(row.make) ||
      !/[a-z0-9]/i.test(row.model) ||
      /^(unknown|n\/a)$/i.test(row.make) ||
      /^(unknown|n\/a)$/i.test(row.model)
    )
      reasons.push("missing-native-year-make-model");
    return {
      row,
      vin,
      reasons,
      signature: shopifyYardHash([
        row.year,
        row.make.toLowerCase(),
        row.model.toLowerCase(),
        row.status,
        row.stockNumber,
        row.detailsUrl,
      ]),
    };
  });
  const signatures = new Map<string, Set<string>>();
  for (const a of assessments)
    if (a.vin)
      signatures.set(
        a.vin,
        new Set([...(signatures.get(a.vin) ?? []), a.signature]),
      );
  const conflicts = new Set(
    [...signatures].filter(([, s]) => s.size > 1).map(([vin]) => vin),
  );
  const vehicles = new Map<string, CanonicalVehicle>();
  const observedVins = new Set<string>();
  const accounting = {
    recordsProcessed: rows.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const { row, vin, reasons } of assessments) {
    const conflict = vin !== null && conflicts.has(vin);
    if (row.status === "excluded" && !conflict) {
      accounting.recordsExcluded++;
      continue;
    }
    if (vin) observedVins.add(vin);
    if (!vin || reasons.length || conflict) {
      accounting.recordsRejected++;
      continue;
    }
    if (vehicles.has(vin)) {
      accounting.duplicateVehicles++;
      continue;
    }
    vehicles.set(vin, {
      source: yard.source,
      vin,
      year: Number(row.year),
      make: normalizeCanonicalMake(row.make),
      model: row.model,
      color: normalizeCanonicalColor(row.color),
      stockNumber: row.stockNumber,
      imageUrl: row.imageUrl,
      availableDate: null,
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      state,
      stateAbbr: yard.state,
      lat: yard.lat,
      lng: yard.lng,
      detailsUrl: row.detailsUrl,
      partsUrl: null,
      pricesUrl: null,
      section: null,
      row: null,
      space: null,
      engine: null,
      transmission: null,
      trim: null,
    });
  }
  const active = rows.length - accounting.recordsExcluded;
  if (
    (previous !== null && (!Number.isSafeInteger(previous) || previous < 0)) ||
    vehicles.size < minimum ||
    accounting.recordsRejected / active >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / active >
      SourceValidationPolicy.maximumDuplicateRatio ||
    (previous !== null &&
      vehicles.size < previous * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    throw new Error(
      `${yard.source} complete census failed inventory floor, 10% rejection, duplicate or previous-count drift guards (${vehicles.size} accepted, ${accounting.recordsRejected} rejected, ${accounting.recordsExcluded} excluded); prior inventory is preserved`,
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
  };
}
