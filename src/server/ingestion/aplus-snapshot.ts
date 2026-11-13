import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  aplusHash,
  type AplusControl,
  type AplusPage,
  type AplusRecord,
} from "./aplus-parser";
import { inventoryVin } from "./inventory-vin";
import {
  transformAplusRecord,
  aplusNativeIdentity,
  type AplusCanonicalVehicle,
  type AplusModelContext,
} from "./aplus-transform";
import { SourceValidationPolicy } from "./source-validation";

export interface AplusMake extends AplusControl {
  models: AplusControl[] | null;
}
export function aplusModels(makes: readonly AplusMake[]) {
  return makes.flatMap((make) =>
    (make.models ?? []).map((model) => ({ make, model })),
  );
}

/** Root refreshes overlap temporally. Deduplicate identical required observations
 * only within this surface, retaining every native YMM/destination variant. */
export function aplusArrivalUnion(pages: readonly AplusPage[]): AplusRecord[] {
  const rows = new Map<
    string,
    {
      record: AplusRecord;
      stocks: Set<string>;
      images: Set<string>;
      dates: Set<string>;
    }
  >();
  for (const page of pages)
    for (const record of page.records) {
      const key = aplusHash([record[0], record[1], record[2], record[4]]);
      const entry = rows.get(key) ?? {
        record,
        stocks: new Set<string>(),
        images: new Set<string>(),
        dates: new Set<string>(),
      };
      if (record[3]) entry.stocks.add(record[3]);
      if (record[5] !== null) entry.images.add(record[5]);
      if (record[6] !== null) entry.dates.add(record[6]);
      rows.set(key, entry);
    }
  return [...rows.values()].map(
    ({ record, stocks, images, dates }): AplusRecord => [
      record[0],
      record[1],
      record[2],
      stocks.size === 1 ? ([...stocks][0] ?? "") : "",
      record[4],
      images.size === 1 ? ([...images][0] ?? null) : null,
      dates.size === 1 ? ([...dates][0] ?? null) : null,
    ],
  );
}

export function aplusSnapshot(
  makes: readonly AplusMake[],
  pages: readonly AplusPage[],
  arrivals: readonly AplusPage[],
) {
  const models = aplusModels(makes);
  const records: { record: AplusRecord; context: AplusModelContext }[] = [];
  for (const [index, page] of pages.entries()) {
    const control = models[index];
    if (!control)
      throw new Error(
        "Aplus model evidence exceeds the literal published graph",
      );
    records.push(
      ...page.records.map((record) => ({
        record,
        context: { make: control.make.label, model: control.model.label },
      })),
    );
  }
  const labels = makes.map((m) => m.label).sort((a, b) => b.length - a.length);
  const arrivalContext = (record: AplusRecord): AplusModelContext => {
    const make =
      labels.find((label) => record[2].startsWith(label + " ")) ?? "";
    return { make, model: "" };
  };
  for (const record of aplusArrivalUnion(arrivals))
    records.push({ record, context: arrivalContext(record) });
  const grouped = new Map<
    string,
    { year: string; make: string; model: string; destination: string }[]
  >();
  const destinations = new Map<string, Set<string>>();
  for (const { record, context } of records) {
    const vin = inventoryVin(record[0], record[1]);
    if (!vin) continue;
    const native = aplusNativeIdentity(record, context);
    const group = grouped.get(vin) ?? [];
    group.push({
      year: record[1],
      make: native.make,
      model: native.model,
      destination: record[4],
    });
    grouped.set(vin, group);
    const identities = destinations.get(record[4]) ?? new Set<string>();
    identities.add(vin);
    destinations.set(record[4], identities);
  }
  const conflicts = new Set(
    [...grouped].flatMap(([vin, group]) =>
      new Set(
        group.map((r) =>
          JSON.stringify([r.year, r.make, r.model, r.destination]),
        ),
      ).size > 1
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
  const vehicles = new Map<string, AplusCanonicalVehicle>();
  const observedVins = new Set<string>();
  const optionalKeys = ["imageUrl", "availableDate", "stockNumber"] as const;
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], Set<string>>
  >();
  const rememberOptional = (vehicle: AplusCanonicalVehicle) => {
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
    const result = transformAplusRecord(record, context);
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
      const result = transformAplusRecord(record, arrivalContext(record));
      if (result.status === "available" && vehicles.has(result.vehicle.vin))
        rememberOptional(result.vehicle);
    }
  // Missing optional values preserve genuine supplied metadata. Conflicting
  // supplied values become null without changing required identity accounting.
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values)
      throw new Error(
        "Aplus accepted identity lost its optional metadata state",
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

export function validateAplusSnapshot(
  snapshot: ReturnType<typeof aplusSnapshot>,
) {
  const { vehicles, accounting } = snapshot;
  const observed =
    vehicles.length + accounting.duplicateVehicles + accounting.recordsRejected;
  if (observed !== accounting.recordsProcessed || vehicles.length < 1000)
    throw new Error(
      "Aplus finite native union accounting changed or accepted inventory is below 1000 donors",
    );
  if (
    accounting.recordsRejected / observed >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / observed >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Aplus required rejection exceeds 10% or benign duplicates exceed 25%; preserve prior inventory and inspect all native rejected observations",
    );
}
