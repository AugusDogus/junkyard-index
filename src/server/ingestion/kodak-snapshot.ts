import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { KodakRecord } from "./kodak-parser";
import {
  kodakNativeIdentity,
  transformKodakRecord,
  type KodakCanonicalVehicle,
} from "./kodak-transform";
import { SourceValidationPolicy } from "./source-validation";
import { conflictingVins } from "./vin-conflicts";

export function kodakSnapshot(records: KodakRecord[]) {
  const conflicts = conflictingVins(records, (record) => {
    const native = kodakNativeIdentity(record);
    const vin = inventoryVin(record.fields.VIN ?? "", native.year);
    return vin ? { vin, signature: JSON.stringify(native) } : null;
  });
  const vehicles = new Map<string, KodakCanonicalVehicle>();
  const optionalValues = new Map<
    string,
    Record<"color" | "imageUrl" | "engine", Set<string>>
  >();
  const observedVins = new Set<string>();
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const record of records) {
    const result = transformKodakRecord(record);
    const vin =
      result.status === "incomplete" ? result.vin : result.vehicle.vin;
    if (
      result.status === "incomplete" ||
      (vin !== null && conflicts.has(vin))
    ) {
      accounting.recordsRejected++;
      if (vin) observedVins.add(vin);
    } else {
      const vehicle = result.vehicle;
      const metadata = optionalValues.get(vehicle.vin) ?? {
        color: new Set<string>(),
        imageUrl: new Set<string>(),
        engine: new Set<string>(),
      };
      for (const key of ["color", "imageUrl", "engine"] as const)
        if (vehicle[key] !== null) metadata[key].add(vehicle[key]);
      optionalValues.set(vehicle.vin, metadata);
      if (vehicles.has(vehicle.vin)) accounting.duplicateVehicles++;
      else vehicles.set(vehicle.vin, vehicle);
    }
  }
  for (const vehicle of vehicles.values()) {
    const metadata = optionalValues.get(vehicle.vin);
    if (!metadata) continue;
    for (const key of ["color", "imageUrl", "engine"] as const)
      vehicle[key] =
        metadata[key].size === 1 ? ([...metadata[key]][0] ?? null) : null;
  }
  // Kodak publishes a shared roster URL, not distinct donor routes. The page
  // may describe many VINs without becoming a reverse destination collision.
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
  };
}

export function validateKodakSnapshot(
  snapshot: ReturnType<typeof kodakSnapshot>,
): void {
  const { vehicles, accounting } = snapshot;
  const total =
    vehicles.length + accounting.duplicateVehicles + accounting.recordsRejected;
  if (total !== accounting.recordsProcessed || vehicles.length < 12)
    throw new Error(
      "Kodak complete inventory does not reconcile or is below the 12-donor minimum",
    );
  if (
    accounting.recordsRejected / total >
    SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      "Kodak required donor rejection exceeds the unchanged 10% limit",
    );
  if (
    accounting.duplicateVehicles / total >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error("Kodak benign duplication exceeds the unchanged 25% limit");
}
