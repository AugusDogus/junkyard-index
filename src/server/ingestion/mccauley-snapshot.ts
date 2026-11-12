import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { MccauleyCurrent, MccauleyDetail } from "./mccauley-parser";
import {
  mccauleyCurrentRecords,
  mccauleyDetailRecords,
  transformMccauleyRecord,
  type MccauleyCanonicalVehicle,
} from "./mccauley-record";
import { SourceValidationPolicy } from "./source-validation";

/** Rebuild every counter and duplicate identity from bounded native evidence. */
export function mccauleySnapshot(
  current: MccauleyCurrent,
  details: MccauleyDetail[],
) {
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: 0,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const records = details.flatMap((detail) => {
    const parsed = mccauleyDetailRecords(detail);
    accounting.recordsProcessed += parsed.missingIdentities;
    accounting.recordsRejected += parsed.missingIdentities;
    return parsed.records;
  });
  // Native detail records precede matching-list aliases, preserving the donor
  // destination and explicitly labelled transmission without a second emission.
  records.push(...mccauleyCurrentRecords(current));
  const vehicles = new Map<string, MccauleyCanonicalVehicle>();
  const rejectedVins = new Set<string>();
  for (const record of records) {
    accounting.recordsProcessed++;
    const result = transformMccauleyRecord(record);
    if (result.status === "incomplete") {
      accounting.recordsRejected++;
      if (result.vin !== null) {
        if (vehicles.has(result.vin) || rejectedVins.has(result.vin))
          throw new Error(
            "McCauley rejected donor reuses an observed native VIN " +
              result.vin,
          );
        rejectedVins.add(result.vin);
      }
      continue;
    }
    const vehicle = result.vehicle;
    const previous = vehicles.get(vehicle.vin);
    if (
      rejectedVins.has(vehicle.vin) ||
      (previous &&
        (previous.year !== vehicle.year ||
          previous.make !== vehicle.make ||
          previous.model !== vehicle.model))
    )
      throw new Error(
        "McCauley native VIN has conflicting donor identity " + vehicle.vin,
      );
    if (previous) accounting.duplicateVehicles++;
    else vehicles.set(vehicle.vin, vehicle);
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...rejectedVins],
    accounting,
  };
}

export function validateMccauleySnapshot(
  snapshot: ReturnType<typeof mccauleySnapshot>,
): void {
  const { accounting, vehicles } = snapshot;
  const observed =
    vehicles.length + accounting.duplicateVehicles + accounting.recordsRejected;
  if (observed !== accounting.recordsProcessed || vehicles.length < 20)
    throw new Error(
      "McCauley complete census accounting changed or accepted inventory is below the 20-donor minimum",
    );
  if (
    accounting.recordsRejected / observed >
    SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      "McCauley required donor rejection exceeds the unchanged 10% limit",
    );
  if (
    accounting.duplicateVehicles / observed >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "McCauley duplicate donor ratio exceeds the unchanged 25% limit",
    );
}
