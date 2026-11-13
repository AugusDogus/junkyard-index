import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { MeeksRecord } from "./meeks-parser";
import {
  transformMeeksRecord,
  type MeeksCanonicalVehicle,
} from "./meeks-transform";
import { SourceValidationPolicy } from "./source-validation";

const rawVin = (record: MeeksRecord) => record.vin.trim().toUpperCase();
const identity = (record: MeeksRecord) =>
  JSON.stringify([
    record.year.trim(),
    record.make.trim().toUpperCase(),
    record.model.trim().toUpperCase(),
  ]);
const emptyAccounting = (): ConnectorChunkAccounting => ({
  recordsProcessed: 0,
  recordsExcluded: 0,
  recordsRejected: 0,
  duplicateVehicles: 0,
});

/** The full listing enumerates donors. The smaller source-owned listing checks
 * their claims; it never inflates the primary source denominator or duplicates. */
export function meeksSnapshot(
  primary: readonly MeeksRecord[],
  consistency: readonly MeeksRecord[],
) {
  const groups = new Map<
    string,
    { primary: MeeksRecord[]; controls: MeeksRecord[] }
  >();
  for (const record of primary) {
    const key = rawVin(record);
    const group = groups.get(key) ?? { primary: [], controls: [] };
    group.primary.push(record);
    groups.set(key, group);
  }
  for (const record of consistency) {
    const group = groups.get(rawVin(record));
    if (!group || !rawVin(record))
      throw new Error(
        "Meeks consistency donor is absent from the primary full inventory; previous inventory is preserved. Inspect both published views before reconciling.",
      );
    group.controls.push(record);
  }
  const accounting = emptyAccounting();
  const consistencyAccounting = emptyAccounting();
  accounting.recordsProcessed = primary.length;
  consistencyAccounting.recordsProcessed = consistency.length;
  const vehicles: MeeksCanonicalVehicle[] = [];
  const observedVins = new Set<string>();
  const conflictingVins: string[] = [];
  const optionalFields = [
    "color",
    "stockNumber",
    "imageUrl",
    "availableDate",
    "section",
    "row",
  ] as const;
  for (const [key, group] of groups) {
    const conflict =
      new Set([...group.primary, ...group.controls].map(identity)).size > 1;
    if (conflict) conflictingVins.push(key);
    let vehicle: MeeksCanonicalVehicle | null = null;
    const metadata = new Map<string, Set<string>>();
    for (const [records, counts, isPrimary] of [
      [group.primary, accounting, true],
      [group.controls, consistencyAccounting, false],
    ] as const) {
      for (const record of records) {
        const result = transformMeeksRecord(record);
        if (conflict || result.status === "incomplete") {
          counts.recordsRejected++;
          const vin = inventoryVin(record.vin, record.year);
          if (vin) observedVins.add(vin);
          continue;
        }
        if (isPrimary && vehicle === null) vehicle = { ...result.vehicle };
        else counts.duplicateVehicles++;
        for (const field of optionalFields) {
          const value = result.vehicle[field];
          const values = metadata.get(field) ?? new Set<string>();
          if (value !== null) values.add(value);
          metadata.set(field, values);
        }
      }
    }
    if (vehicle) {
      for (const field of optionalFields) {
        const values = metadata.get(field) ?? new Set<string>();
        vehicle[field] = values.size === 1 ? ([...values][0] ?? null) : null;
      }
      vehicles.push(vehicle);
    }
  }
  if (
    vehicles.length +
      accounting.recordsRejected +
      accounting.duplicateVehicles !==
      primary.length ||
    consistencyAccounting.recordsRejected +
      consistencyAccounting.duplicateVehicles !==
      consistency.length
  )
    throw new Error(
      "Meeks primary/consistency accounting does not reconcile; preserve the prior snapshot and inspect every raw donor claim.",
    );
  return {
    vehicles,
    observedVins: [...observedVins].sort(),
    accounting,
    consistencyAccounting,
    rawViewObservations: primary.length + consistency.length,
    conflictingVins: conflictingVins.sort(),
    qualityWithinExistingRatios:
      primary.length > 0 &&
      vehicles.length > 0 &&
      accounting.recordsRejected / primary.length <=
        SourceValidationPolicy.maximumRejectionRatio &&
      accounting.duplicateVehicles / primary.length <=
        SourceValidationPolicy.maximumDuplicateRatio,
  };
}
