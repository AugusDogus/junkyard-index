import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { RmmdtpContract } from "./rmmdtp-contract";
import type { RmmdtpRecord } from "./rmmdtp-record";
import { RmmdtpResult } from "./rmmdtp-result";
import { SourceValidationPolicy } from "./source-validation";
import {
  assessRmmdtpRecord,
  rmmdtpClaimKey,
  transformRmmdtpRecord,
  type RmmdtpCanonicalVehicle,
} from "./rmmdtp-transform";

export function rmmdtpSnapshot(
  records: readonly RmmdtpRecord[],
  contract: RmmdtpContract,
) {
  const rows = records.map(assessRmmdtpRecord);
  const groups = new Map<string, Set<number>>(),
    quarantine = new Set<number>();
  rows.forEach((row, index) => {
    for (const key of [
      `id:${row.record.id}`,
      ...(row.vin === null ? [] : [`vin:${row.vin}`]),
    ]) {
      const group = groups.get(key) ?? new Set<number>();
      group.add(index);
      groups.set(key, group);
    }
    if (row.reasons.some((reason) => reason.startsWith("conflicting-")))
      quarantine.add(index);
  });
  const conflicts: { key: string; indices: number[] }[] = [];
  for (const [key, indices] of groups) {
    const signatures = new Set(
      [...indices].map((index) => {
        const row = rows[index];
        if (!row) throw new Error("Native conflict group lost its record");
        return JSON.stringify([
          row.record.id,
          row.record.detailsUrl,
          row.vin,
          row.year,
          rmmdtpClaimKey(row.make),
          rmmdtpClaimKey(row.model),
          row.condition,
        ]);
      }),
    );
    if (signatures.size > 1) {
      conflicts.push({ key, indices: [...indices] });
      for (const index of indices) quarantine.add(index);
    }
  }
  let prior = -1;
  while (prior !== quarantine.size) {
    prior = quarantine.size;
    for (const indices of groups.values())
      if ([...indices].some((index) => quarantine.has(index)))
        for (const index of indices) quarantine.add(index);
  }
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: 0,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, RmmdtpCanonicalVehicle>(),
    observed = new Set<string>();
  const metadata = new Map<string, RmmdtpCanonicalVehicle[]>();
  const rejectedIndices: number[] = [],
    excludedIndices: number[] = [];
  rows.forEach((row, index) => {
    accounting.recordsProcessed++;
    // Quarantine precedes positive sale exclusion, preserving all valid VINs
    // connected to an identity, destination or donor/Complete contradiction.
    if (quarantine.has(index)) {
      accounting.recordsRejected++;
      rejectedIndices.push(index);
      if (row.vin !== null) observed.add(row.vin);
      return;
    }
    if (row.condition === "Complete") {
      accounting.recordsExcluded++;
      excludedIndices.push(index);
      return;
    }
    const vehicle = transformRmmdtpRecord(row.record, contract);
    if (vehicle === null) {
      accounting.recordsRejected++;
      rejectedIndices.push(index);
      if (row.vin !== null) observed.add(row.vin);
      return;
    }
    if (vehicles.has(vehicle.vin)) accounting.duplicateVehicles++;
    else vehicles.set(vehicle.vin, vehicle);
    metadata.set(vehicle.vin, [...(metadata.get(vehicle.vin) ?? []), vehicle]);
  });
  for (const [vin, vehicle] of vehicles) {
    for (const key of ["stockNumber", "imageUrl", "engine"] as const) {
      const values = [
        ...new Set(
          (metadata.get(vin) ?? []).flatMap((row) =>
            row[key] === null ? [] : [row[key]],
          ),
        ),
      ];
      vehicle[key] = values.length === 1 ? (values[0] ?? null) : null;
    }
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observed].sort(),
    accounting,
    conflicts,
    rejectedIndices,
    excludedIndices,
    quarantinedIndices: [...quarantine].sort((a, b) => a - b),
  };
}
export type RmmdtpSnapshot = ReturnType<typeof rmmdtpSnapshot>;
export function validateRmmdtpSnapshot(
  snapshot: RmmdtpSnapshot,
  contract: RmmdtpContract,
  previous: number | null,
) {
  const a = snapshot.accounting,
    accepted = snapshot.vehicles.length,
    candidates = a.recordsProcessed - a.recordsExcluded;
  const reasons: string[] = [];
  if (
    accepted + a.recordsRejected + a.recordsExcluded + a.duplicateVehicles !==
    a.recordsProcessed
  )
    reasons.push("native accounting does not reconcile");
  if (accepted < contract.minimumUniqueInventory)
    reasons.push(
      `accepted ${accepted} is below the qualified minimum ${contract.minimumUniqueInventory}`,
    );
  if (
    candidates > 0 &&
    a.recordsRejected / candidates >
      SourceValidationPolicy.maximumRejectionRatio
  )
    reasons.push("required rejects exceed 10%");
  if (
    candidates > 0 &&
    a.duplicateVehicles / candidates >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    reasons.push("benign duplicates exceed 25%");
  if (
    previous !== null &&
    accepted <
      Math.floor(previous * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    reasons.push(
      "accepted inventory fell below 50% of the previous complete run",
    );
  return reasons.length
    ? ({
        ok: false,
        error: RmmdtpResult.error(
          "complete-source validation",
          reasons.join("; "),
        ),
      } as const)
    : ({ ok: true, value: snapshot } as const);
}
