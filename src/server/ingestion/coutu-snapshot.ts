import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { CoutuControl, CoutuPage } from "./coutu-parser";
import {
  coutuVin,
  transformCoutuRecord,
  type CoutuCanonicalVehicle,
} from "./coutu-transform";
import { SourceValidationPolicy } from "./source-validation";

export interface CoutuMake extends CoutuControl {
  models: CoutuControl[] | null;
}
export function coutuModels(makes: readonly CoutuMake[]) {
  return makes.flatMap((make) =>
    (make.models ?? []).map((model) => ({ make, model })),
  );
}

/** Retain independent native claims until the whole finite graph is known.
 * No first/last winner is chosen for an ambiguous identity or destination. */
export function coutuSnapshot(pages: readonly CoutuPage[]) {
  const records = pages.flatMap((page) => page.records);
  const groups = new Map<
    string,
    {
      years: Set<string>;
      makes: Set<string>;
      models: Set<string>;
      destinations: Set<string>;
    }
  >();
  const destinations = new Map<string, Set<string>>();
  for (const record of records) {
    const vin = coutuVin(record);
    if (!vin) continue;
    const group = groups.get(vin) ?? {
      years: new Set<string>(),
      makes: new Set<string>(),
      models: new Set<string>(),
      destinations: new Set<string>(),
    };
    group.years.add(record[1]).add(record[2]);
    group.makes.add(record[3]).add(record[5]);
    group.models.add(record[4]).add(record[6]);
    group.destinations.add(record[8]);
    groups.set(vin, group);
    const claims = destinations.get(record[8]) ?? new Set<string>();
    claims.add(vin);
    destinations.set(record[8], claims);
  }
  const conflicts = new Set<string>();
  for (const [vin, group] of groups)
    if (Object.values(group).some((values) => values.size !== 1))
      conflicts.add(vin);
  for (const claims of destinations.values())
    if (claims.size > 1) for (const vin of claims) conflicts.add(vin);
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, CoutuCanonicalVehicle>();
  const observedVins = new Set<string>();
  const optional = new Map<
    string,
    { stockNumber: Set<string>; imageUrl: Set<string> }
  >();
  for (const record of records) {
    const vin = coutuVin(record);
    if (vin && conflicts.has(vin)) {
      accounting.recordsRejected++;
      observedVins.add(vin);
      continue;
    }
    const result = transformCoutuRecord(record);
    if (result.status === "incomplete") {
      accounting.recordsRejected++;
      if (result.vin) observedVins.add(result.vin);
      continue;
    }
    const vehicle = result.vehicle;
    const values = optional.get(vehicle.vin) ?? {
      stockNumber: new Set<string>(),
      imageUrl: new Set<string>(),
    };
    for (const key of ["stockNumber", "imageUrl"] as const)
      if (vehicle[key] !== null) values[key].add(vehicle[key]);
    optional.set(vehicle.vin, values);
    if (vehicles.has(vehicle.vin)) accounting.duplicateVehicles++;
    else vehicles.set(vehicle.vin, vehicle);
  }
  for (const [vin, vehicle] of vehicles) {
    const values = optional.get(vin);
    if (!values)
      throw new Error(
        "Coutu accepted identity lost its optional metadata state",
      );
    for (const key of ["stockNumber", "imageUrl"] as const)
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

export function validateCoutuSnapshot(
  snapshot: ReturnType<typeof coutuSnapshot>,
) {
  const { vehicles, accounting } = snapshot;
  const total =
    vehicles.length + accounting.duplicateVehicles + accounting.recordsRejected;
  if (total !== accounting.recordsProcessed || vehicles.length < 418)
    throw new Error(
      "Coutu finite graph accounting changed or accepted inventory is below 418 donors",
    );
  if (
    accounting.recordsRejected / total >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / total >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Coutu required rejection exceeds 10% or benign duplicates exceed 25%; preserve prior inventory and inspect all native rejected observations",
    );
}
