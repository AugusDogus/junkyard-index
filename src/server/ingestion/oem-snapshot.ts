import type { ConnectorChunkAccounting } from "./connector-chunk";
import { SourceValidationPolicy } from "./source-validation";
import type { OemPage } from "./oem-parser";
import { assessOemRecord, oemFields, type OemCandidate } from "./oem-record";

export interface OemSnapshot {
  vehicles: OemCandidate[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
  conflicts: {
    domain: "vin" | "destination";
    value: string;
    indices: number[];
  }[];
  quarantinedIndices: number[];
  ownershipAlerts: string[];
}
type Groups = Map<string, Set<number>>;
const add = (groups: Groups, value: string, index: number) => {
  const group = groups.get(value) ?? new Set<number>();
  group.add(index);
  groups.set(value, group);
};
function create(
  pages: readonly OemPage[],
  nativeMakes: readonly string[],
): OemSnapshot {
  const rows = pages
    .flatMap((p) => p.records)
    .map((record) => ({
      assessment: assessOemRecord(record, nativeMakes),
      claims: {
        years: oemFields(record, "year"),
        titles: oemFields(record, "make/model"),
        vins: oemFields(record, "vin").map((v) => v.toUpperCase()),
        destinations: record.destinations,
      },
    }));
  const vins: Groups = new Map(),
    destinations: Groups = new Map();
  const quarantine = new Set<number>();
  rows.forEach(({ assessment, claims }, i) => {
    for (const vin of assessment.validVinClaims) add(vins, vin, i);
    for (const destination of claims.destinations)
      add(destinations, destination, i);
    if (assessment.reasons.some((r) => r.includes("conflict")))
      quarantine.add(i);
  });
  const conflicts: OemSnapshot["conflicts"] = [];
  for (const [domain, groups] of [
    ["vin", vins],
    ["destination", destinations],
  ] as const) {
    for (const [value, indices] of groups) {
      const claims = {
        years: new Set<string>(),
        titles: new Set<string>(),
        vins: new Set<string>(),
        destinations: new Set<string>(),
      };
      for (const index of indices) {
        const row = rows[index];
        if (!row)
          throw new Error("OEM identity group lost an observed occurrence");
        for (const key of ["years", "titles", "vins", "destinations"] as const)
          for (const claim of row.claims[key])
            if (claim.trim()) claims[key].add(claim.trim());
      }
      if (Object.values(claims).some((s) => s.size > 1)) {
        conflicts.push({ domain, value, indices: [...indices] });
        for (const index of indices) quarantine.add(index);
      }
    }
  }
  const pending = [...quarantine],
    visited = new Set<string>();
  for (let i = 0; i < pending.length; i++) {
    const index = pending[i],
      row = index === undefined ? undefined : rows[index];
    if (!row) throw new Error("OEM quarantine lost an observed occurrence");
    for (const [domain, values, groups] of [
      ["vin", row.assessment.validVinClaims, vins],
      ["destination", row.claims.destinations, destinations],
    ] as const)
      for (const value of values) {
        const key = domain + ":" + value;
        if (visited.has(key)) continue;
        visited.add(key);
        for (const member of groups.get(value) ?? [])
          if (!quarantine.has(member)) {
            quarantine.add(member);
            pending.push(member);
          }
      }
  }
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: rows.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, OemCandidate>(),
    observed = new Set<string>();
  const optionalKeys = [
    "stockNumber",
    "imageUrl",
    "availableDate",
    "color",
    "row",
  ] as const;
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], Set<string>>
  >();
  rows.forEach(({ assessment }, i) => {
    if (assessment.status !== "required-pass" || quarantine.has(i)) {
      accounting.recordsRejected++;
      for (const vin of assessment.validVinClaims) observed.add(vin);
      return;
    }
    const candidate = assessment.candidate;
    const values = metadata.get(candidate.vin) ?? {
      stockNumber: new Set<string>(),
      imageUrl: new Set<string>(),
      availableDate: new Set<string>(),
      color: new Set<string>(),
      row: new Set<string>(),
    };
    for (const key of optionalKeys)
      if (candidate[key] !== null) values[key].add(candidate[key]);
    metadata.set(candidate.vin, values);
    if (vehicles.has(candidate.vin)) accounting.duplicateVehicles++;
    else vehicles.set(candidate.vin, { ...candidate });
  });
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values) throw new Error("OEM accepted VIN lost its metadata group");
    for (const key of optionalKeys)
      vehicle[key] =
        values[key].size === 1 ? ([...values[key]][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observed].sort(),
    accounting,
    conflicts,
    quarantinedIndices: [...quarantine].sort((a, b) => a - b),
    ownershipAlerts: [
      ...new Set(rows.flatMap((r) => r.assessment.ownershipAlerts)),
    ],
  };
}
function validate(
  snapshot: OemSnapshot,
  input: {
    minimumUniqueInventory: number;
    previousUniqueInventory: number | null;
  },
): { ok: true; value: OemSnapshot } | { ok: false; reasons: string[] } {
  const reasons: string[] = [],
    { accounting: a, vehicles } = snapshot;
  const total = a.recordsProcessed - a.recordsExcluded;
  if (
    !Object.values(a).every((v) => Number.isSafeInteger(v) && v >= 0) ||
    vehicles.length + a.recordsRejected + a.duplicateVehicles !== total
  )
    reasons.push("native union accounting does not reconcile");
  if (
    !Number.isSafeInteger(input.minimumUniqueInventory) ||
    input.minimumUniqueInventory < 1 ||
    vehicles.length < input.minimumUniqueInventory
  )
    reasons.push("accepted count is below the qualification minimum");
  if (
    total &&
    a.recordsRejected / total > SourceValidationPolicy.maximumRejectionRatio
  )
    reasons.push("required rejection exceeds 10%");
  if (
    total &&
    a.duplicateVehicles / total > SourceValidationPolicy.maximumDuplicateRatio
  )
    reasons.push("benign duplicates exceed 25%");
  if (
    input.previousUniqueInventory !== null &&
    (!Number.isSafeInteger(input.previousUniqueInventory) ||
      input.previousUniqueInventory < 0 ||
      vehicles.length <
        input.previousUniqueInventory *
          SourceValidationPolicy.minimumPreviousRunRatio)
  )
    reasons.push(
      "accepted count is below 50% of the previous complete inventory or previous count is invalid",
    );
  if (snapshot.ownershipAlerts.length)
    reasons.push("native photo supplier assertions require ownership review");
  return reasons.length
    ? { ok: false, reasons }
    : { ok: true, value: snapshot };
}
export const OemSnapshot = { create, validate } as const;
