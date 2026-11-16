import { inventoryVin } from "./inventory-vin";
import { cstruckChecksum } from "./cstruck-snapshot";
import { normalizeCanonicalMake, normalizeRegion } from "./normalization";
import {
  SourceValidationPolicy,
  validateSourceSnapshot,
} from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { HeavyTruckPartsRecord } from "./heavytruckparts-record";
import {
  HTP_SUPPLIERS,
  type HtpSupplier,
} from "./heavytruckparts-yard-metadata";
import { htpRoster } from "./heavytruckparts-census";
import type { HtpCensus } from "./heavytruckparts-cursor";

export type HtpVehicle = CanonicalVehicle & { source: "heavytruckparts" };
const key = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
const missing = (s: string) =>
  /^(?:|UNKNOWN|OTHER|NONE|NULL|N\/?A|-|0+)$/.test(key(s));
const salvage =
  /\b(?:salvage|parts (?:only|truck|vehicle)|for parts|dismantl\w*|wreck\w*|does not run|not running|no start|no compression|some of truck apart|missing fuel tank|needs injection pump|no transmission|can ?not be sold complete)\b/i;
const equipmentMakes = new Set([
  "ATTACHMENT",
  "DEERE",
  "JOHN DEERE",
  "HYSTER",
  "TCM",
  "GROVE",
  "SIMON",
  "YALE",
  "KOMATSU",
  "BOBCAT",
  "CASE",
  "CLARK",
  "GENIE",
  "JLG",
  "BLAW-KNOX",
  "EUCLID",
  "ROADTEC",
  "SULLAIR",
  "INGERSOL RAND",
]);
export function htpExclusion(
  r: HeavyTruckPartsRecord,
  s: HtpSupplier,
): string | null {
  const identity = key(`${r.make} ${r.model}`);
  if (
    equipmentMakes.has(key(r.make)) ||
    (["CAT", "CATERPILLAR"].includes(key(r.make)) &&
      !/^CT(?:660|680)$/.test(key(r.model))) ||
    /^(?:HEIL PNEUMATIC|TALBERT RGN|EPIC 6P|AVALON TAHOE|UNIVERSAL CAR CRUSHER)$/.test(
      identity,
    ) ||
    /\b(?:TRAILER|GOLF CART|FORKLIFT|EXCAVATOR|BACKHOE|SKID STEER|ATTACHMENT|BOAT|WAVERUNNER|WHEEL LOADER|CAR CRUSHER|COMPRESSOR)\b/.test(
      identity,
    ) ||
    /^NISSAN OPTIMUM/.test(identity)
  )
    return "equipment-trailer-or-golf-cart";
  if (/whole truck for resale/i.test(r.url + " " + r.description))
    return "retail-resale";
  // American has separate dealership and parts operations. A generic USED label
  // does not establish that a whole truck is a salvage unit.
  if (s.code === "american" && !salvage.test(r.description))
    return "unproven-salvage-unit";
  if (
    (r.price?.startsWith("$") ||
      /\b(?:[\d,]+\s+miles|test drvn|runs (?:and drives|great|good)|ready to (?:work|haul|go)|fleet maintained|super nice)\b/i.test(
        r.description,
      )) &&
    !salvage.test(r.description)
  )
    return "retail-resale";
  return null;
}
// Exact native HTP labels, not make/model inference from descriptions or VINs.
const makeAliases = new Map([
  ["WESTERN STAR TR", "Western Star"],
  ["WHITEGMC", "White GMC"],
  ["UD TRUCK", "UD"],
]);
export function htpSupplierSnapshot(
  s: HtpSupplier,
  records: readonly HeavyTruckPartsRecord[],
) {
  const vehicles = new Map<string, HtpVehicle>(),
    observedVins = new Set<string>();
  const rejected: { id: string; reason: string }[] = [],
    excluded: { id: string; reason: string }[] = [];
  const accounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const r of records) {
    const exclusion = htpExclusion(r, s);
    if (exclusion) {
      accounting.recordsExcluded++;
      excluded.push({ id: r.id, reason: exclusion });
      continue;
    }
    const vin = inventoryVin(r.vin, r.year),
      year = Number(r.year);
    if (
      !vin ||
      missing(r.vin) ||
      !/^\d{4}$/.test(r.year) ||
      year < 1886 ||
      year > new Date().getUTCFullYear() + 1 ||
      missing(r.make) ||
      missing(r.model) ||
      (year >= 1981 && !cstruckChecksum(vin))
    ) {
      accounting.recordsRejected++;
      if (vin) observedVins.add(vin);
      rejected.push({ id: r.id, reason: "required-vehicle-identity" });
      continue;
    }
    const region = normalizeRegion(s.yard.state);
    if (s.yard.lat === null || s.yard.lng === null)
      throw new Error(
        `HTP ${s.code} has no verified physical yard coordinates`,
      );
    const vehicle: HtpVehicle = {
      source: "heavytruckparts",
      vin,
      year,
      make: makeAliases.get(key(r.make)) ?? normalizeCanonicalMake(r.make),
      model: r.model,
      stockNumber: null,
      color: null,
      imageUrl: r.imageUrl,
      availableDate: null,
      locationCode: s.code,
      locationName: s.yard.name,
      locationCity: s.yard.city,
      state: region.state,
      stateAbbr: region.stateAbbr,
      lat: s.yard.lat,
      lng: s.yard.lng,
      detailsUrl: r.url,
      partsUrl: null,
      pricesUrl: null,
      engine: r.engine ?? null,
      trim: null,
      transmission: r.transmission ?? null,
      section: null,
      row: null,
      space: null,
    };
    const prior = vehicles.get(vin);
    if (prior) {
      if (
        prior.year !== year ||
        key(prior.make) !== key(vehicle.make) ||
        key(prior.model) !== key(vehicle.model)
      )
        throw new Error(`HTP ${s.code} separate items conflict on one VIN`);
      accounting.duplicateVehicles++;
    } else vehicles.set(vin, vehicle);
  }
  if ([...observedVins].some((v) => vehicles.has(v)))
    throw new Error(
      `HTP ${s.code} rejected identity overlaps an eligible item`,
    );
  const denominator = records.length - accounting.recordsExcluded;
  if (
    vehicles.size < s.minimum ||
    accounting.recordsRejected / denominator >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / denominator >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      `HTP ${s.code} supplier quality failed: ${vehicles.size} accepted, ${accounting.recordsRejected} rejected, ${accounting.recordsExcluded} excluded, ${accounting.duplicateVehicles} duplicates`,
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    rejected,
    excluded,
    accounting,
  };
}
export function htpSnapshot(
  censuses: readonly HtpCensus[],
  previousAcceptedCount: number | null,
) {
  if (censuses.length !== HTP_SUPPLIERS.length)
    throw new Error("HTP source census is incomplete");
  const vehicles = new Map<string, HtpVehicle>(),
    observedVins = new Set<string>(),
    warnings: string[] = [];
  const accounting = {
    recordsProcessed: 0,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const [index, s] of HTP_SUPPLIERS.entries()) {
    const census = censuses[index];
    if (!census || census.code !== s.code)
      throw new Error("HTP supplier census order changed");
    const snap = htpSupplierSnapshot(
      s,
      htpRoster(s, census.pages, census.total),
    );
    for (const field of [
      "recordsProcessed",
      "recordsRejected",
      "recordsExcluded",
      "duplicateVehicles",
    ] as const)
      accounting[field] += snap.accounting[field];
    for (const row of snap.vehicles) {
      const prior = vehicles.get(row.vin);
      if (prior)
        throw new Error(
          `HTP VIN ${row.vin} appears at multiple physical yards; review ownership`,
        );
      vehicles.set(row.vin, row);
    }
    for (const vin of snap.observedVins) observedVins.add(vin);
    warnings.push(
      ...snap.rejected.map((r) => `HTP ${s.code} item ${r.id}: ${r.reason}`),
    );
  }
  if ([...observedVins].some((v) => vehicles.has(v)))
    throw new Error("HTP rejected identity overlaps another supplier");
  const validation = validateSourceSnapshot({
    source: "heavytruckparts",
    terminal: true,
    uniqueVehicles: vehicles.size,
    vehiclesProcessed: accounting.recordsProcessed - accounting.recordsExcluded,
    duplicateVehicles: accounting.duplicateVehicles,
    rejectedVehicles: accounting.recordsRejected,
    errors: [],
    previousAcceptedCount,
  });
  if (validation.status === "rejected")
    throw new Error(validation.errors.join("; "));
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    accounting,
    warnings,
  };
}
