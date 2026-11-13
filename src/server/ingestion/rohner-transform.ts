import type { RohnerArticleResult, RohnerCandidate } from "./rohner-record";
import { classifyRohnerSnapshot } from "./rohner-snapshot";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import { ROHNER_YARD } from "./rohner-yard-metadata";

export type RohnerCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "rohner";
};

export function transformRohnerCandidate(
  candidate: RohnerCandidate,
): RohnerCanonicalVehicle {
  return {
    ...candidate,
    source: "rohner",
    locationCode: ROHNER_YARD.code,
    locationName: ROHNER_YARD.name,
    locationCity: ROHNER_YARD.city,
    state: "Minnesota",
    stateAbbr: "MN",
    lat: ROHNER_YARD.lat,
    lng: ROHNER_YARD.lng,
  };
}

/** Reconcile every native claim before excluding explicitly sold rebuilders.
 * Rejected valid identities retain presence without supplying vehicle fields.
 */
export function rohnerInventorySnapshot(records: RohnerArticleResult[]) {
  const snapshot = classifyRohnerSnapshot(records);
  return {
    vehicles: snapshot.candidates.map(transformRohnerCandidate),
    observedVins: snapshot.presentVins,
    accounting: {
      recordsProcessed: snapshot.recordsProcessed,
      recordsExcluded: snapshot.exclusions.length,
      recordsRejected: snapshot.rejected.length,
      duplicateVehicles: snapshot.duplicateExtras,
    },
  };
}

export function validateRohnerInventorySnapshot(
  snapshot: ReturnType<typeof rohnerInventorySnapshot>,
) {
  const {
    recordsProcessed,
    recordsExcluded,
    recordsRejected,
    duplicateVehicles,
  } = snapshot.accounting;
  const active = recordsProcessed - recordsExcluded;
  if (
    !snapshot.vehicles.length ||
    active <= 0 ||
    recordsRejected / active > SourceValidationPolicy.maximumRejectionRatio ||
    duplicateVehicles / active > SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Rohner complete donor quality exceeds the unchanged 10% rejection or 25% duplicate limit, or leaves no valid donor; retain prior inventory and inspect every native claim",
    );
}
