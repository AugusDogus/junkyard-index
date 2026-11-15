import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import { dutchersHash } from "./dutchers-html";
import type { DutchersPage, DutchersRecord } from "./dutchers-parser";
import type { DutchersScope } from "./dutchers-scope";
import { DUTCHERS_PAGE_SIZE, DUTCHERS_YARD } from "./dutchers-yard-metadata";

export type DutchersCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "dutchers";
};
const key = (raw: string) => raw.trim().replace(/\s+/g, " ").toUpperCase();
const missing = (raw: string) =>
  !key(raw) || /^(?:UNKNOWN|OTHER|NONE|NULL|N\/?A|-|0+)$/.test(key(raw));

/** Repeated destinations across native sort pages are traversal overlap. Distinct
 * item destinations with the same VIN are source duplicates and are accounted. */
export function dutchersRoster(
  pages: readonly DutchersPage[],
  total: number,
): DutchersRecord[] {
  const size = Math.ceil(total / DUTCHERS_PAGE_SIZE);
  const rows = new Map<string, DutchersRecord>();
  const years: Map<string, number>[] = [];
  for (const direction of ["DESC", "ASC"] as const) {
    const group = pages.filter((p) => p.direction === direction);
    if (
      group.length !== size ||
      group.some(
        (p, i) =>
          p.page !== i + 1 ||
          p.records.length !==
            Math.min(DUTCHERS_PAGE_SIZE, total - i * DUTCHERS_PAGE_SIZE),
      )
    )
      throw new Error(
        "Dutcher complete roster lost a native page in one of its two year orders",
      );
    const counts = new Map<string, number>();
    for (const record of group.flatMap((p) => p.records)) {
      counts.set(record.year, (counts.get(record.year) ?? 0) + 1);
      const prior = rows.get(record.id);
      if (prior && dutchersHash(prior) !== dutchersHash(record))
        throw new Error(
          "Dutcher repeated item changed its native identity or metadata during traversal",
        );
      rows.set(record.id, record);
    }
    years.push(counts);
  }
  if (
    pages.length !== size * 2 ||
    rows.size !== total ||
    dutchersHash([...(years[0] ?? [])].sort()) !==
      dutchersHash([...(years[1] ?? [])].sort())
  )
    throw new Error(
      "Dutcher dual-sort enumeration does not reconcile to the independent store total and year counts",
    );
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function dutchersSnapshot(
  records: readonly DutchersRecord[],
  scope: DutchersScope,
) {
  const vehicles = new Map<string, DutchersCanonicalVehicle>();
  const observedVins = new Set<string>();
  const rejects: {
    record: DutchersRecord;
    vin: string | null;
    reason: string;
    nativeReason: string | null;
  }[] = [];
  const accounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const r of records) {
    const vin = inventoryVin(r.vin, r.year);
    const retailOverlap =
      r.year === "2020" &&
      key(r.make) === "FREIGHTLINER" &&
      /^M2 106(?: |$)/.test(key(r.model));
    const rebuildOverlap =
      r.year === "2024" &&
      key(r.make) === "CAT" &&
      /^306(?: |$)/.test(key(r.model));
    if (
      retailOverlap ||
      rebuildOverlap ||
      !vin ||
      !/^\d{4}$/.test(r.year) ||
      Number(r.year) < 1886 ||
      Number(r.year) > 2100 ||
      missing(r.make) ||
      missing(r.model)
    ) {
      accounting.recordsRejected++;
      if (vin) observedVins.add(vin);
      rejects.push({
        record: r,
        vin,
        reason:
          retailOverlap || rebuildOverlap
            ? "unresolved-native-scope"
            : "required-identity",
        nativeReason: retailOverlap
          ? scope.quarantineReasons[0]
          : rebuildOverlap
            ? scope.quarantineReasons[1]
            : null,
      });
      continue;
    }
    const vehicle: DutchersCanonicalVehicle = {
      source: "dutchers",
      vin,
      year: Number(r.year),
      make: normalizeCanonicalMake(r.make),
      model: r.model,
      stockNumber: null,
      color: null,
      imageUrl: r.imageUrl,
      availableDate: null,
      locationCode: DUTCHERS_YARD.code,
      locationName: DUTCHERS_YARD.name,
      locationCity: DUTCHERS_YARD.city,
      state: "New York",
      stateAbbr: "NY",
      lat: DUTCHERS_YARD.lat,
      lng: DUTCHERS_YARD.lng,
      detailsUrl: r.url,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
      section: null,
      row: null,
      space: null,
    };
    const prior = vehicles.get(vin);
    if (prior) {
      if (
        prior.year !== vehicle.year ||
        key(prior.make) !== key(vehicle.make) ||
        key(prior.model) !== key(vehicle.model)
      )
        throw new Error(
          "Dutcher separate items conflict on required claims for one VIN",
        );
      accounting.duplicateVehicles++;
    } else vehicles.set(vin, vehicle);
  }
  if ([...observedVins].some((vin) => vehicles.has(vin)))
    throw new Error(
      "Dutcher rejected identity also has an eligible item; inspect every native claim",
    );
  if (
    !vehicles.size ||
    accounting.recordsRejected / records.length >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / records.length >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Dutcher complete roster has no eligible vehicles or exceeds the existing rejection/duplicate limits",
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    rejects,
    accounting,
  };
}
