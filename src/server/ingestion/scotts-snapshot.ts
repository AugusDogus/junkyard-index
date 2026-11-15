import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ScottsControl, ScottsPage } from "./scotts-parser";
import { inventoryVin } from "./inventory-vin";
import {
  scottsNativeIdentity,
  transformScottsRecord,
  type ScottsCanonicalVehicle,
} from "./scotts-transform";
import { SourceValidationPolicy } from "./source-validation";

export interface ScottsMake extends ScottsControl {
  models: ScottsControl[] | null;
}
export const scottsModels = (makes: readonly ScottsMake[]) =>
  makes.flatMap((make) =>
    (make.models ?? []).map((model) => ({ make, model })),
  );

export function scottsSnapshot(
  makes: readonly ScottsMake[],
  pages: readonly ScottsPage[],
) {
  const models = scottsModels(makes);
  if (pages.length !== models.length)
    throw new Error("Scotts snapshot is missing published model evidence");
  const records = pages.flatMap((page, index) => {
    const control = models[index];
    if (!control) throw new Error("Scotts page exceeds its published graph");
    const context = {
      make: control.make.label,
      model: control.model.label,
      makePath: control.make.path,
    };
    return page.records.map((record) => ({
      record,
      context,
      result: transformScottsRecord(record, context),
    }));
  });
  const vins = new Map<string, typeof records>();
  const destinations = new Map<string, typeof records>();
  const donorIds = new Map<string, typeof records>();
  for (const row of records) {
    const vin = inventoryVin(row.record[0], row.record[1]);
    if (vin) vins.set(vin, [...(vins.get(vin) ?? []), row]);
    if (row.record[4])
      destinations.set(row.record[4], [
        ...(destinations.get(row.record[4]) ?? []),
        row,
      ]);
    if (row.record[6])
      donorIds.set(row.record[6], [
        ...(donorIds.get(row.record[6]) ?? []),
        row,
      ]);
  }
  const conflicts = new Set<string>();
  for (const [vin, group] of vins) {
    const identities = group.map(({ record, context }) => {
      const native = scottsNativeIdentity(record, context);
      return JSON.stringify([record[1], native.make, native.model, record[4]]);
    });
    if (
      new Set(identities).size > 1 ||
      group.some((row) => row.result.status === "incomplete")
    )
      conflicts.add(vin);
  }
  for (const group of [...destinations.values(), ...donorIds.values()]) {
    const identities = new Set(
      group.map((row) =>
        JSON.stringify([
          inventoryVin(row.record[0], row.record[1]) ?? row.record[0],
          row.record[1],
          row.record[2],
          row.record[4],
        ]),
      ),
    );
    if (
      identities.size > 1 ||
      group.some((row) => row.result.status === "incomplete")
    )
      for (const row of group) {
        const vin = inventoryVin(row.record[0], row.record[1]);
        if (vin) conflicts.add(vin);
      }
  }
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, ScottsCanonicalVehicle>();
  const observedVins = new Set<string>();
  const metadata = new Map<
    string,
    { stockNumber: Set<string>; imageUrl: Set<string> }
  >();
  for (const { result } of records) {
    if (result.status === "incomplete" || conflicts.has(result.vehicle.vin)) {
      accounting.recordsRejected++;
      const vin =
        result.status === "incomplete" ? result.vin : result.vehicle.vin;
      if (vin) observedVins.add(vin);
      continue;
    }
    const vehicle = result.vehicle;
    const values = metadata.get(vehicle.vin) ?? {
      stockNumber: new Set<string>(),
      imageUrl: new Set<string>(),
    };
    if (vehicle.stockNumber !== null)
      values.stockNumber.add(vehicle.stockNumber);
    if (vehicle.imageUrl !== null) values.imageUrl.add(vehicle.imageUrl);
    metadata.set(vehicle.vin, values);
    if (vehicles.has(vehicle.vin)) accounting.duplicateVehicles++;
    else vehicles.set(vehicle.vin, { ...vehicle });
  }
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values)
      throw new Error("Scotts accepted identity lost optional metadata");
    vehicle.stockNumber =
      values.stockNumber.size === 1
        ? ([...values.stockNumber][0] ?? null)
        : null;
    vehicle.imageUrl =
      values.imageUrl.size === 1 ? ([...values.imageUrl][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
    conflictingVins: [...conflicts].sort(),
  };
}

export function validateScottsSnapshot(
  snapshot: ReturnType<typeof scottsSnapshot>,
) {
  const { vehicles, accounting } = snapshot;
  const observed =
    vehicles.length + accounting.recordsRejected + accounting.duplicateVehicles;
  if (observed !== accounting.recordsProcessed || vehicles.length < 800)
    throw new Error(
      "Scotts complete native accounting changed or accepted inventory is below 800 donors; preserve prior inventory",
    );
  if (
    accounting.recordsRejected / observed >
      SourceValidationPolicy.maximumRejectionRatio ||
    accounting.duplicateVehicles / observed >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Scotts required rejects exceed 10% or duplicates exceed 25%; preserve prior inventory and inspect native observations",
    );
  if (
    snapshot.observedVins.some((vin) =>
      vehicles.some((vehicle) => vehicle.vin === vin),
    )
  )
    throw new Error("Scotts rejected VIN presence overlaps emitted inventory");
}
