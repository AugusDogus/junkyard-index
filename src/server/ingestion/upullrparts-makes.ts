import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
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

/**
 * Vehicle rows carry no make, and per-make getVehicles partitions now need a
 * Turnstile token per page. Resolve a make only when exactly one make in the
 * public model directory lists the vehicle's model. The directory does not
 * depend on the catalog, so it can load while the catalog is fetched.
 */
export function loadUpullRPartsMakeResolver(requestGate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const makes = yield* fetchUpullRPartsMakes(requestGate);
    const normalized = makes.map(normalizeCanonicalMake);
    if (new Set(normalized).size !== makes.length)
      return yield* new UpullRPartsMakeError({
        message:
          "U Pull R Parts getMakes returned duplicate normalized labels. Inspect the directory before retrying; no vehicle batches were emitted.",
      });
    const models = new Map<string, Set<string>>();
    // Check every make before calling a model relation unique. The directory
    // contains real cross-make collisions, including MUSTANG and FORD E250 VAN.
    for (const make of makes) {
      // Preserve raw directory labels in requests (including the trailing space in Ram).
      const labels = yield* fetchUpullRPartsModels(make, requestGate);
      for (const label of labels)
        addCandidate(models, modelKey(label), normalizeCanonicalMake(make));
    }
    return (record: UpullRPartsVehicle): UpullRPartsMakeResolution => {
      const modelCandidates = models.get(modelKey(record.Model));
      const modelMake = uniqueMake(modelCandidates);
      if (modelMake !== null) return { status: "resolved", make: modelMake };
      return {
        status: "unresolved",
        reason:
          modelCandidates && modelCandidates.size > 1
            ? `ambiguous provider model relation (${[...modelCandidates].join(", ")})`
            : "no matching provider model relation",
      };
    };
  });
}
