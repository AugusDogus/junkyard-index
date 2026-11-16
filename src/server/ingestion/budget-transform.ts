import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { BudgetRecord } from "./budget-parser";
import {
  BUDGET_YARD,
  BUDGET_MINIMUM,
  budgetPageUrl,
} from "./budget-yard-metadata";
export type BudgetCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "budget";
};
const usable = (v: string) =>
  v.length > 0 &&
  /[A-Z0-9]/i.test(v) &&
  !/^(?:unknown|other|n\/?a|null|none|undefined)$/i.test(v);
function date(raw: string) {
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(raw);
  if (!m) return null;
  const value = `20${m[3]}-${m[1]}-${m[2]}`;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function budgetSnapshot(records: readonly BudgetRecord[]) {
  const vehicles = new Map<string, BudgetCanonicalVehicle>(),
    observedVins = new Set<string>();
  const claims = new Map<string, Set<string>>();
  const stockClaims = new Map<string, Set<string>>();
  const accounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const r of records) {
    if (usable(r.stock)) {
      const values = stockClaims.get(r.stock) ?? new Set<string>();
      values.add(
        JSON.stringify([r.vin.toUpperCase(), r.year, r.make, r.model]),
      );
      stockClaims.set(r.stock, values);
    }
    const vin = inventoryVinWithCheckDigit(r.vin, r.year);
    if (vin) {
      const s = claims.get(vin) ?? new Set<string>();
      s.add(JSON.stringify([r.year, r.make, r.model]));
      claims.set(vin, s);
    }
  }
  for (const r of records) {
    const vin = inventoryVinWithCheckDigit(r.vin, r.year),
      year = Number(r.year);
    if (
      !vin ||
      /^([A-Z0-9])\1+$/.test(vin) ||
      !/^\d{4}$/.test(r.year) ||
      year < 1886 ||
      year > 2100 ||
      !usable(r.make) ||
      !usable(r.model) ||
      (claims.get(vin)?.size ?? 0) > 1 ||
      (stockClaims.get(r.stock)?.size ?? 0) > 1
    ) {
      accounting.recordsRejected++;
      if (vin) observedVins.add(vin);
      continue;
    }
    if (vehicles.has(vin)) {
      accounting.duplicateVehicles++;
      continue;
    }
    vehicles.set(vin, {
      source: "budget",
      vin,
      year,
      make: normalizeCanonicalMake(r.make),
      model: r.model,
      color: null,
      stockNumber: usable(r.stock) ? r.stock : null,
      imageUrl: null,
      availableDate: date(r.date),
      locationCode: BUDGET_YARD.code,
      locationName: BUDGET_YARD.name,
      locationCity: BUDGET_YARD.city,
      state: "Florida",
      stateAbbr: "FL",
      lat: BUDGET_YARD.lat,
      lng: BUDGET_YARD.lng,
      row: usable(r.row) ? r.row : null,
      section: null,
      space: null,
      detailsUrl: budgetPageUrl(r.make),
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
  };
}
export function validateBudgetSnapshot(s: ReturnType<typeof budgetSnapshot>) {
  const a = s.accounting;
  if (
    s.vehicles.length < BUDGET_MINIMUM ||
    a.recordsRejected / a.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / a.recordsProcessed >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      `Budget complete inventory failed its ${BUDGET_MINIMUM}-donor floor, 10% rejection or 25% duplicate guard`,
    );
}
