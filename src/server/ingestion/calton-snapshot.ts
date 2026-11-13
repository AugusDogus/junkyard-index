import type { CaltonCanonicalVehicle, CaltonLocation } from "./calton-contract";
import type { CaltonPage } from "./calton-parser";
import { CaltonRecord } from "./calton-record";
import { caltonOwnedUrl, caltonText } from "./calton-html";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { SourceValidationPolicy } from "./source-validation";
import { transformCaltonCandidate } from "./calton-transform";

export interface CaltonSnapshot {
  vehicles: CaltonCanonicalVehicle[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
  conflicts: {
    domain: "vin" | "destination";
    value: string;
    recordIndices: number[];
  }[];
  quarantinedRecordIndices: number[];
}

type Groups = Map<string, Set<number>>;
function add(groups: Groups, value: string, index: number) {
  const group = groups.get(value) ?? new Set<number>();
  group.add(index);
  groups.set(value, group);
}

/** Compare the whole native union before display normalization or deduplication.
 * A contradictory appearance contaminates every connected VIN/destination. */

function create(
  pages: readonly CaltonPage[],
  nativeMakes: readonly string[],
  location: CaltonLocation,
): CaltonSnapshot {
  const rows = pages
    .flatMap((page) => page.records)
    .map((record) => ({
      assessment: CaltonRecord.assess(record, nativeMakes),
      claims: {
        years: record.years,
        titles: record.titles,
        vins: record.vins.map((vin) => vin.trim().toUpperCase()),
        destinations: record.destinations.flatMap(({ literal }) => {
          const url =
            literal === null
              ? null
              : caltonOwnedUrl(caltonText(literal), record.sourceUrl);
          return url ? [url.href] : [];
        }),
      },
    }));
  const vins: Groups = new Map(),
    destinations: Groups = new Map();
  const quarantine = new Set<number>();
  rows.forEach(({ assessment, claims }, index) => {
    for (const vin of assessment.validVinClaims) add(vins, vin, index);
    for (const destination of claims.destinations)
      add(destinations, destination, index);
    if (assessment.reasons.some((reason) => reason.includes("conflict")))
      quarantine.add(index);
  });
  const conflicts: CaltonSnapshot["conflicts"] = [];
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
          throw new Error(
            "Calton native conflict group lost its assessed appearance",
          );
        for (const key of ["years", "titles", "vins", "destinations"] as const)
          for (const claim of row.claims[key])
            if (claim.trim()) claims[key].add(claim.trim());
      }
      if (Object.values(claims).some((values) => values.size > 1)) {
        conflicts.push({ domain, value, recordIndices: [...indices] });
        for (const index of indices) quarantine.add(index);
      }
    }
  }
  const pending = [...quarantine];
  const visitedVins = new Set<string>(),
    visitedDestinations = new Set<string>();
  for (let position = 0; position < pending.length; position++) {
    const index = pending[position];
    const row = index === undefined ? undefined : rows[index];
    if (!row)
      throw new Error("Calton native quarantine lost its assessed appearance");
    for (const [values, groups, visited] of [
      [row.assessment.validVinClaims, vins, visitedVins],
      [row.claims.destinations, destinations, visitedDestinations],
    ] as const) {
      for (const value of values) {
        if (visited.has(value)) continue;
        visited.add(value);
        for (const member of groups.get(value) ?? []) {
          if (quarantine.has(member)) continue;
          quarantine.add(member);
          pending.push(member);
        }
      }
    }
  }
  const vehicles = new Map<string, CaltonCanonicalVehicle>();
  const observed = new Set<string>();
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
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: rows.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  rows.forEach(({ assessment }, index) => {
    if (assessment.status !== "required-pass" || quarantine.has(index)) {
      accounting.recordsRejected++;
      for (const vin of assessment.validVinClaims) observed.add(vin);
      return;
    }
    const candidate = transformCaltonCandidate(assessment.candidate, location);
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
    else vehicles.set(candidate.vin, candidate);
  });
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values)
      throw new Error("Calton accepted VIN lost its optional metadata group");
    for (const key of optionalKeys)
      vehicle[key] =
        values[key].size === 1 ? ([...values[key]][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observed].sort(),
    accounting,
    conflicts,
    quarantinedRecordIndices: [...quarantine].sort(
      (left, right) => left - right,
    ),
  };
}

export interface CaltonSnapshotError {
  tag: "CaltonSnapshotError";
  operation: "complete-source validation";
  message: string;
}

function validate(
  snapshot: CaltonSnapshot,
  input: {
    minimumUniqueInventory: number;
    previousUniqueInventory: number | null;
  },
):
  | { ok: true; value: CaltonSnapshot }
  | { ok: false; error: CaltonSnapshotError } {
  const { vehicles, accounting } = snapshot;
  const total = accounting.recordsProcessed - accounting.recordsExcluded;
  const reasons: string[] = [];
  if (
    !Object.values(accounting).every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    vehicles.length +
      accounting.recordsRejected +
      accounting.duplicateVehicles !==
      total
  )
    reasons.push("native union accounting does not reconcile");
  if (
    !Number.isSafeInteger(input.minimumUniqueInventory) ||
    input.minimumUniqueInventory <= 0
  )
    reasons.push("qualification minimum must be a positive safe integer");
  else if (vehicles.length < input.minimumUniqueInventory)
    reasons.push(
      `accepted inventory ${vehicles.length} is below root-supplied minimum ${input.minimumUniqueInventory}`,
    );
  if (
    total > 0 &&
    accounting.recordsRejected / total >
      SourceValidationPolicy.maximumRejectionRatio
  )
    reasons.push("required rejection exceeds 10%");
  if (
    total > 0 &&
    accounting.duplicateVehicles / total >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    reasons.push("benign duplicates exceed 25%");
  if (input.previousUniqueInventory !== null) {
    if (
      !Number.isSafeInteger(input.previousUniqueInventory) ||
      input.previousUniqueInventory < 0
    )
      reasons.push(
        "previous complete inventory count must be a nonnegative safe integer",
      );
    else if (
      vehicles.length <
      input.previousUniqueInventory *
        SourceValidationPolicy.minimumPreviousRunRatio
    )
      reasons.push(
        "accepted inventory fell below 50% of the previous complete run",
      );
  }
  return reasons.length
    ? {
        ok: false,
        error: {
          tag: "CaltonSnapshotError",
          operation: "complete-source validation",
          message: `Calton complete-source validation: ${reasons.join("; ")}. Reconciliation is blocked and prior inventory is preserved. Inspect the saved native union and start a new complete capture after resolving the reported failures.`,
        },
      }
    : { ok: true, value: snapshot };
}

export const CaltonSnapshot = { create, validate } as const;
