import type { CanonicalVehicle } from "./types";
import type {
  BrandywineCandidate,
  BrandywineRecord,
} from "./brandywine-record";
import { classifyBrandywineSnapshot } from "./brandywine-snapshot";
import { BRANDYWINE_YARD } from "./brandywine-yard-metadata";
import { SourceValidationPolicy } from "./source-validation";

export const BRANDYWINE_MINIMUM_INVENTORY = 602;
export type BrandywineCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "brandywine";
};
export function transformBrandywineCandidate(
  candidate: BrandywineCandidate,
): BrandywineCanonicalVehicle {
  return {
    ...candidate,
    source: "brandywine",
    locationCode: BRANDYWINE_YARD.code,
    locationName: BRANDYWINE_YARD.name,
    locationCity: BRANDYWINE_YARD.city,
    state: "Maryland",
    stateAbbr: "MD",
    lat: BRANDYWINE_YARD.lat,
    lng: BRANDYWINE_YARD.lng,
    imageUrl: null,
    section: null,
    space: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
export function brandywineInventorySnapshot(records: BrandywineRecord[]) {
  const result = classifyBrandywineSnapshot(records);
  return {
    vehicles: result.candidates.map(transformBrandywineCandidate),
    observedVins: result.presentVins,
    accounting: {
      recordsProcessed: result.recordsProcessed,
      recordsExcluded: result.exclusions.length,
      recordsRejected: result.rejected.length,
      duplicateVehicles: result.duplicateExtras,
    },
  };
}
export function validateBrandywineInventorySnapshot(
  snapshot: ReturnType<typeof brandywineInventorySnapshot>,
  previousAcceptedCount: number | null,
) {
  const {
    recordsProcessed,
    recordsExcluded,
    recordsRejected,
    duplicateVehicles,
  } = snapshot.accounting;
  const active = recordsProcessed - recordsExcluded;
  if (
    previousAcceptedCount !== null &&
    (!Number.isSafeInteger(previousAcceptedCount) || previousAcceptedCount < 0)
  )
    throw new Error(
      "Brandywine prior accepted count must be an authoritative nonnegative integer or explicit null",
    );
  if (
    snapshot.vehicles.length + duplicateVehicles + recordsRejected !== active ||
    snapshot.vehicles.length < BRANDYWINE_MINIMUM_INVENTORY ||
    active <= 0 ||
    recordsRejected / active > SourceValidationPolicy.maximumRejectionRatio ||
    duplicateVehicles / active > SourceValidationPolicy.maximumDuplicateRatio ||
    (previousAcceptedCount !== null &&
      snapshot.vehicles.length <
        Math.floor(
          previousAcceptedCount *
            SourceValidationPolicy.minimumPreviousRunRatio,
        ))
  )
    throw new Error(
      "Brandywine complete snapshot fails its 602 minimum, accounting partition, 10% rejection, 25% duplicate or 50% prior-drift guard; prior inventory is preserved. Inspect required native claims and the authoritative prior accepted count",
    );
}
