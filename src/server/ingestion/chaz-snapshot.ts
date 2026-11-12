import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  chazHash,
  type ChazControl,
  type ChazPage,
  type ChazRecord,
} from "./chaz-parser";
import { inventoryVin } from "./inventory-vin";
import {
  transformChazRecord,
  type ChazCanonicalVehicle,
  type ChazModelContext,
} from "./chaz-transform";
import { SourceValidationPolicy } from "./source-validation";

export interface ChazMake extends ChazControl {
  models: ChazControl[] | null;
}
export function chazModels(makes: readonly ChazMake[]) {
  return makes.flatMap((make) =>
    (make.models ?? []).map((model) => ({ make, model })),
  );
}

/** Root refreshes overlap temporally. Deduplicate identical required observations
 * only within this surface, retaining every native YMM/destination variant. */
export function chazArrivalUnion(pages: readonly ChazPage[]): ChazRecord[] {
  const rows = new Map<
    string,
    { record: ChazRecord; images: Set<string>; dates: Set<string> }
  >();
  for (const page of pages)
    for (const record of page.records) {
      const key = chazHash(record.slice(0, 5));
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
    ({ record, images, dates }): ChazRecord => [
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

export function chazSnapshot(
  makes: readonly ChazMake[],
  pages: readonly ChazPage[],
  arrivals: readonly ChazPage[],
) {
  const models = chazModels(makes);
  const records: { record: ChazRecord; context: ChazModelContext }[] = [];
  for (const [index, page] of pages.entries()) {
    const control = models[index];
    if (!control)
      throw new Error(
        "Chaz model evidence exceeds the literal published graph",
      );
    records.push(
      ...page.records.map((record) => ({
        record,
        context: { make: control.make.label, model: control.model.label },
      })),
    );
  }
  const labels = makes.map((m) => m.label).sort((a, b) => b.length - a.length);
  const arrivalContext = (record: ChazRecord): ChazModelContext => {
    const make =
      labels.find((label) => record[2].startsWith(label + " ")) ??
      record[2].split(" ")[0] ??
      "";
    return { make, model: "" };
  };
  for (const record of chazArrivalUnion(arrivals))
    records.push({ record, context: arrivalContext(record) });
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
  const vehicles = new Map<string, ChazCanonicalVehicle>();
  const observedVins = new Set<string>();
  const optionalKeys = ["imageUrl", "availableDate", "stockNumber"] as const;
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], Set<string>>
  >();
  const rememberOptional = (vehicle: ChazCanonicalVehicle) => {
    const values = metadata.get(vehicle.vin) ?? {
      imageUrl: new Set<string>(),
      availableDate: new Set<string>(),
      stockNumber: new Set<string>(),
    };
    for (const key of optionalKeys)
      if (vehicle[key] !== null) values[key].add(vehicle[key]);
    metadata.set(vehicle.vin, values);
  };
  for (const { record, context } of records) {
    const result = transformChazRecord(record, context);
    if (result.status === "incomplete" || conflicts.has(result.vehicle.vin)) {
      accounting.recordsRejected++;
      const vin =
        result.status === "incomplete" ? result.vin : result.vehicle.vin;
      if (vin) observedVins.add(vin);
      continue;
    }
    const vehicle = result.vehicle;
    rememberOptional(vehicle);
    const previous = vehicles.get(vehicle.vin);
    if (previous) {
      accounting.duplicateVehicles++;
    } else vehicles.set(vehicle.vin, { ...vehicle });
  }
  // Temporal repeats count once, but every supplied optional value still
  // participates. Otherwise an arrival disagreement merged to null could be
  // replaced by a model value that agrees with only one of those arrivals.
  for (const page of arrivals)
    for (const record of page.records) {
      const result = transformChazRecord(record, arrivalContext(record));
      if (result.status === "available" && vehicles.has(result.vehicle.vin))
        rememberOptional(result.vehicle);
    }
  // Missing optional values preserve genuine supplied metadata. Conflicting
  // supplied values become null without changing required identity accounting.
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values)
      throw new Error(
        "Chaz accepted identity lost its optional metadata state",
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

export function validateChazSnapshot(
  snapshot: ReturnType<typeof chazSnapshot>,
) {
  const { vehicles, accounting } = snapshot;
  const observed =
    vehicles.length + accounting.duplicateVehicles + accounting.recordsRejected;
  if (observed !== accounting.recordsProcessed || vehicles.length < 900)
    throw new Error(
      "Chaz finite native union accounting changed or accepted inventory is below 900 donors",
    );
  if (
    accounting.recordsRejected / observed >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / observed >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Chaz required rejection exceeds 10% or benign duplicates exceed 25%; preserve prior inventory and inspect all native rejected observations",
    );
}
