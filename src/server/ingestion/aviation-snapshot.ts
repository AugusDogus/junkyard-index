import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  aviationHash,
  type AviationControl,
  type AviationPage,
  type AviationRecord,
} from "./aviation-parser";
import { inventoryVin } from "./inventory-vin";
import {
  transformAviationRecord,
  type AviationCanonicalVehicle,
  type AviationModelContext,
} from "./aviation-transform";
import { SourceValidationPolicy } from "./source-validation";

export interface AviationMake extends AviationControl {
  models: AviationControl[] | null;
}
export function aviationModels(makes: readonly AviationMake[]) {
  return makes.flatMap((make) =>
    (make.models ?? []).map((model) => ({ make, model })),
  );
}

/** Root refreshes overlap temporally. Deduplicate identical required observations
 * only within this surface, retaining every native YMM/destination variant. */
export function aviationArrivalUnion(
  pages: readonly AviationPage[],
): AviationRecord[] {
  const rows = new Map<
    string,
    { record: AviationRecord; images: Set<string>; dates: Set<string> }
  >();
  for (const page of pages)
    for (const record of page.records) {
      const key = aviationHash(record.slice(0, 5));
      const entry = rows.get(key) ?? {
        record,
        images: new Set<string>(),
        dates: new Set<string>(),
      };
      if (record[5] !== null) entry.images.add(record[5]);
      if (record[6] !== null) entry.dates.add(record[6]);
      rows.set(key, entry);
    }
  return [...rows.values()].map(
    ({ record, images, dates }): AviationRecord => [
      record[0],
      record[1],
      record[2],
      record[3],
      record[4],
      images.size === 1 ? ([...images][0] ?? null) : null,
      dates.size === 1 ? ([...dates][0] ?? null) : null,
    ],
  );
}

export function aviationSnapshot(
  makes: readonly AviationMake[],
  pages: readonly AviationPage[],
  arrivals: readonly AviationPage[],
) {
  const models = aviationModels(makes);
  const records: { record: AviationRecord; context: AviationModelContext }[] =
    [];
  for (const [index, page] of pages.entries()) {
    const control = models[index];
    if (!control)
      throw new Error(
        "Aviation model evidence exceeds the literal published graph",
      );
    records.push(
      ...page.records.map((record) => ({
        record,
        context: { make: control.make.label, model: control.model.label },
      })),
    );
  }
  const labels = makes.map((m) => m.label).sort((a, b) => b.length - a.length);
  for (const record of aviationArrivalUnion(arrivals)) {
    const make =
      labels.find((label) => record[2].startsWith(label + " ")) ?? "";
    records.push({ record, context: { make, model: "" } });
  }
  const grouped = new Map<
    string,
    { year: string; make: string; model: string }[]
  >();
  const destinations = new Map<string, Set<string>>();
  for (const { record, context } of records) {
    const vin = inventoryVin(record[0], record[1]);
    if (!vin) continue;
    const model = record[2].startsWith(context.make + " ")
      ? record[2].slice(context.make.length).trim()
      : context.model;
    const group = grouped.get(vin) ?? [];
    group.push({ year: record[1], make: context.make, model });
    grouped.set(vin, group);
    const identities = destinations.get(record[4]) ?? new Set<string>();
    identities.add(vin);
    destinations.set(record[4], identities);
  }
  const conflicts = new Set(
    [...grouped].flatMap(([vin, group]) =>
      new Set(group.map((r) => JSON.stringify([r.year, r.make, r.model])))
        .size > 1
        ? [vin]
        : [],
    ),
  );
  for (const identities of destinations.values())
    if (identities.size > 1) for (const vin of identities) conflicts.add(vin);
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, AviationCanonicalVehicle>();
  const observedVins = new Set<string>();
  const optionalKeys = ["imageUrl", "availableDate", "stockNumber"] as const;
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], Set<string>>
  >();
  for (const { record, context } of records) {
    const result = transformAviationRecord(record, context);
    if (result.status === "incomplete" || conflicts.has(result.vehicle.vin)) {
      accounting.recordsRejected++;
      const vin =
        result.status === "incomplete" ? result.vin : result.vehicle.vin;
      if (vin) observedVins.add(vin);
      continue;
    }
    const vehicle = result.vehicle;
    const values = metadata.get(vehicle.vin) ?? {
      imageUrl: new Set<string>(),
      availableDate: new Set<string>(),
      stockNumber: new Set<string>(),
    };
    for (const key of optionalKeys)
      if (vehicle[key] !== null) values[key].add(vehicle[key]);
    metadata.set(vehicle.vin, values);
    const previous = vehicles.get(vehicle.vin);
    if (previous) {
      accounting.duplicateVehicles++;
    } else vehicles.set(vehicle.vin, { ...vehicle });
  }
  // Missing optional values preserve genuine supplied metadata. Conflicting
  // supplied values become null without changing required identity accounting.
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values)
      throw new Error(
        "Aviation accepted identity lost its optional metadata state",
      );
    for (const key of optionalKeys)
      vehicle[key] =
        values[key].size === 1 ? ([...values[key]][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    accounting,
    conflictingVins: [...conflicts],
  };
}

export function validateAviationSnapshot(
  snapshot: ReturnType<typeof aviationSnapshot>,
) {
  const { vehicles, accounting } = snapshot;
  const observed =
    vehicles.length + accounting.duplicateVehicles + accounting.recordsRejected;
  if (observed !== accounting.recordsProcessed || vehicles.length < 20)
    throw new Error(
      "Aviation finite native union accounting changed or accepted inventory is below 20 donors",
    );
  if (
    accounting.recordsRejected / observed >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / observed >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Aviation required rejection exceeds 10% or benign duplicates exceed 25%; preserve prior inventory and inspect all native rejected observations",
    );
}
