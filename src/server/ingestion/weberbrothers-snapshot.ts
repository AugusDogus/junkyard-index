import type { ConnectorChunkAccounting } from "~/server/ingestion/connector-chunk";
import { SourceValidationPolicy } from "~/server/ingestion/source-validation";
import type { WeberbrothersRecord } from "./weberbrothers-parser";
import {
  transformWeberbrothersRecord,
  weberbrothersRecordVins,
  type WeberbrothersCanonicalVehicle,
} from "./weberbrothers-transform";

export function inspectWeberbrothersSnapshot(
  records: readonly WeberbrothersRecord[],
) {
  const assessed = records.map(transformWeberbrothersRecord);
  const groups = new Map<string, Set<number>>();
  records.forEach((record, index) => {
    const keys = weberbrothersRecordVins(record).map((vin) => "vin:" + vin);
    if (record.stock) keys.push("stock:" + record.stock.toUpperCase());
    for (const key of keys) {
      const group = groups.get(key) ?? new Set<number>();
      group.add(index);
      groups.set(key, group);
    }
  });
  const quarantine = new Set<number>();
  const conflicts: { key: string; indices: number[] }[] = [];
  for (const [key, indices] of groups) {
    const headings = new Set<string>(),
      vins = new Set<string>();
    for (const index of indices) {
      const record = records[index];
      if (!record)
        throw new Error("Weber conflict group lost its native record");
      headings.add(record.heading.toUpperCase());
      for (const vin of weberbrothersRecordVins(record)) vins.add(vin);
    }
    if (headings.size > 1 || vins.size > 1) {
      conflicts.push({ key, indices: [...indices] });
      for (const index of indices) quarantine.add(index);
    }
  }
  // A conflicting VIN/stock contaminates all connected appearances.
  const pending = [...quarantine],
    visited = new Set<string>();
  for (let position = 0; position < pending.length; position++) {
    const index = pending[position];
    const record = index === undefined ? undefined : records[index];
    if (!record) throw new Error("Weber quarantine lost its native record");
    const keys = weberbrothersRecordVins(record).map((vin) => "vin:" + vin);
    if (record.stock) keys.push("stock:" + record.stock.toUpperCase());
    for (const key of keys) {
      if (visited.has(key)) continue;
      visited.add(key);
      for (const member of groups.get(key) ?? [])
        if (!quarantine.has(member)) {
          quarantine.add(member);
          pending.push(member);
        }
    }
  }
  const vehicles = new Map<string, WeberbrothersCanonicalVehicle>();
  const observedVins = new Set<string>();
  const rejections: {
    url: string;
    nativePostId: string;
    stock: string;
    heading: string;
    nativeVin: string;
    reason: string;
  }[] = [];
  const duplicates: { vin: string; url: string }[] = [];
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  const metadata = new Map<
    string,
    Map<"color" | "stockNumber" | "imageUrl" | "availableDate", Set<string>>
  >();
  assessed.forEach((result, index) => {
    const record = records[index];
    if (!record) throw new Error("Weber assessment lost its native record");
    if (result.status === "rejected" || quarantine.has(index)) {
      accounting.recordsRejected++;
      rejections.push({
        url: record.post.url,
        nativePostId: record.post.nativePostId,
        stock: record.stock,
        heading: record.heading,
        nativeVin: record.fields.VIN ?? "",
        reason: quarantine.has(index)
          ? "conflicting_native_identity_group"
          : result.status === "rejected"
            ? result.reason
            : "",
      });
      for (const vin of weberbrothersRecordVins(record)) observedVins.add(vin);
      return;
    }
    const vehicle = result.vehicle;
    if (vehicles.has(vehicle.vin)) {
      accounting.duplicateVehicles++;
      duplicates.push({ vin: vehicle.vin, url: record.post.url });
    } else vehicles.set(vehicle.vin, vehicle);
    const fields =
      metadata.get(vehicle.vin) ??
      new Map<
        "color" | "stockNumber" | "imageUrl" | "availableDate",
        Set<string>
      >();
    for (const key of [
      "color",
      "stockNumber",
      "imageUrl",
      "availableDate",
    ] as const) {
      const values = fields.get(key) ?? new Set<string>();
      if (vehicle[key] !== null) values.add(vehicle[key]);
      fields.set(key, values);
    }
    metadata.set(vehicle.vin, fields);
  });
  for (const vehicle of vehicles.values()) {
    const fields = metadata.get(vehicle.vin);
    for (const key of [
      "color",
      "stockNumber",
      "imageUrl",
      "availableDate",
    ] as const) {
      const values = fields?.get(key);
      vehicle[key] = values?.size === 1 ? ([...values][0] ?? null) : null;
    }
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    rejections,
    duplicates,
    conflicts,
    accounting,
  };
}
export type WeberbrothersSnapshot = ReturnType<
  typeof inspectWeberbrothersSnapshot
>;
export function validateWeberbrothersSnapshot(
  snapshot: WeberbrothersSnapshot,
  limits: {
    minimumUniqueInventory: number;
    previousUniqueInventory: number | null;
  },
) {
  const { accounting, vehicles } = snapshot;
  if (
    !Object.values(accounting).every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    vehicles.length +
      accounting.recordsRejected +
      accounting.duplicateVehicles !==
      accounting.recordsProcessed
  )
    throw new Error("Weber source-wide accounting does not reconcile");
  if (
    !Number.isSafeInteger(limits.minimumUniqueInventory) ||
    limits.minimumUniqueInventory < 1 ||
    vehicles.length < limits.minimumUniqueInventory
  )
    throw new Error(
      "Weber unique inventory is below the root-supplied positive minimum",
    );
  if (
    accounting.recordsRejected / accounting.recordsProcessed >
    SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      "Weber required-field rejection exceeds the unchanged 10% limit",
    );
  if (
    accounting.duplicateVehicles / accounting.recordsProcessed >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error("Weber duplicates exceed the unchanged 25% limit");
  const previous = limits.previousUniqueInventory;
  if (
    previous !== null &&
    (!Number.isSafeInteger(previous) ||
      previous < 0 ||
      vehicles.length <
        Math.floor(previous * SourceValidationPolicy.minimumPreviousRunRatio))
  )
    throw new Error(
      "Weber inventory fell below the unchanged 50% previous-run guard or the prior count is invalid",
    );
  return snapshot;
}
