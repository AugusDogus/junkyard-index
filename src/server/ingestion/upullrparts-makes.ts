import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchUpullRPartsMakeInventory,
  fetchUpullRPartsMakes,
  fetchUpullRPartsModels,
  type UpullRPartsVehicle,
} from "./upullrparts-client";
import { normalizeCanonicalMake } from "./normalization";

export class UpullRPartsMakeError extends Data.TaggedError(
  "UpullRPartsMakeError",
)<{
  message: string;
}> {}

export type UpullRPartsMakeResolution =
  | { status: "resolved"; make: string }
  | { status: "unresolved"; reason: string };

function modelKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function vehicleKey(record: UpullRPartsVehicle): string | null {
  const stock = record.StockNumber?.trim();
  const vin = record.VIN?.trim().toUpperCase();
  if (!stock || !vin) return null;
  // Also compare year/model so a changed partition row cannot relabel the
  // original snapshot. Never use a provider partition to add/remove vehicles.
  return JSON.stringify([
    record.Store,
    stock,
    vin,
    record.Year,
    modelKey(record.Model),
  ]);
}

function addCandidate(
  map: Map<string, Set<string>>,
  key: string,
  make: string,
) {
  const candidates = map.get(key) ?? new Set<string>();
  candidates.add(make);
  map.set(key, candidates);
}

function uniqueMake(
  candidates: ReadonlySet<string> | undefined,
): string | null {
  if (candidates?.size !== 1) return null;
  for (const make of candidates) return make;
  return null;
}

/** Authoritative partition membership first; unique provider model relation second. */
export function loadUpullRPartsMakeResolver(
  records: readonly UpullRPartsVehicle[],
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const makes = yield* fetchUpullRPartsMakes(requestGate);
    const normalized = makes.map(normalizeCanonicalMake);
    if (new Set(normalized).size !== makes.length)
      return yield* new UpullRPartsMakeError({
        message:
          "U Pull R Parts getMakes returned duplicate normalized labels. Inspect the directory before retrying; no vehicle batches were emitted.",
      });
    const identities = new Set(
      records.map(vehicleKey).filter((key) => key !== null),
    );
    const partitions = new Map<string, Set<string>>();
    for (const make of makes) {
      // Preserve raw directory labels in requests (including the trailing space in Ram).
      const rows = yield* fetchUpullRPartsMakeInventory(make, requestGate);
      for (const row of rows) {
        const key = vehicleKey(row);
        if (key !== null && identities.has(key))
          addCandidate(partitions, key, normalizeCanonicalMake(make));
      }
    }
    const missingModels = new Set(
      records
        .filter((record) => {
          const key = vehicleKey(record);
          return key === null || !partitions.has(key);
        })
        .map((record) => modelKey(record.Model))
        .filter(Boolean),
    );
    const models = new Map<string, Set<string>>();
    if (missingModels.size > 0) {
      // Check every make before calling a model relation unique. The directory
      // contains real cross-make collisions, including MUSTANG and FORD E250 VAN.
      for (const make of makes) {
        const labels = yield* fetchUpullRPartsModels(make, requestGate);
        for (const label of labels) {
          const key = modelKey(label);
          if (missingModels.has(key))
            addCandidate(models, key, normalizeCanonicalMake(make));
        }
      }
    }
    return (record: UpullRPartsVehicle): UpullRPartsMakeResolution => {
      const key = vehicleKey(record);
      const candidates = key === null ? undefined : partitions.get(key);
      const partitionMake = uniqueMake(candidates);
      if (partitionMake !== null)
        return { status: "resolved", make: partitionMake };
      if (candidates && candidates.size > 1)
        return {
          status: "unresolved",
          reason: `conflicting make partitions (${[...candidates].join(", ")})`,
        };
      const modelCandidates = models.get(modelKey(record.Model));
      const modelMake = uniqueMake(modelCandidates);
      if (modelMake !== null) return { status: "resolved", make: modelMake };
      return {
        status: "unresolved",
        reason:
          modelCandidates && modelCandidates.size > 1
            ? `ambiguous provider model relation (${[...modelCandidates].join(", ")})`
            : "no matching make partition or provider model relation",
      };
    };
  });
}
