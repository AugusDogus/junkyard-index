import { z } from "zod";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { SourceValidationPolicy } from "./source-validation";
import {
  NorthwestRecord,
  type NorthwestAssessment,
  type NorthwestRejectionReason,
} from "./northwest-record";
import {
  NorthwestLocationSchema,
  NorthwestOptionalFields,
  northwestOptionalValue,
  transformNorthwestRecord,
  type NorthwestCandidate,
  type NorthwestLocation,
  type NorthwestOptionalConflict,
} from "./northwest-transform";

const FrozenSchema = z
  .object({
    evidenceKind: z.literal("browserDOM"),
    records: z.array(NorthwestRecord.schema),
  })
  .strict();
type Occurrence = { occurrenceId: string } & (
  | { status: "candidate" | "duplicate"; vin: string }
  | {
      status: "rejected";
      reasons: (
        | NorthwestRejectionReason
        | "connected-native-identity-conflict"
      )[];
    }
);
export interface NorthwestSnapshot {
  evidenceKind: "browserDOM" | "nativeHTML";
  candidates: NorthwestCandidate[];
  observedVins: string[];
  assessments: NorthwestAssessment[];
  occurrences: Occurrence[];
  accounting: ConnectorChunkAccounting;
  conflicts: {
    domain: "vin" | "destination";
    value: string;
    recordIndices: number[];
  }[];
  optionalConflicts: (NorthwestOptionalConflict & { vin: string })[];
  quarantinedRecordIndices: number[];
  quality: {
    denominator: number;
    rejectionRatio: number | null;
    duplicateRatio: number | null;
    issues: (
      | "empty-frozen-occurrences"
      | "rejection-ratio-exceeded"
      | "duplicate-ratio-exceeded"
    )[];
  };
}
export interface NorthwestSnapshotError {
  tag: "NorthwestSnapshotError";
  operation: "frozen-claim assessment";
  detail: string;
}
type SnapshotResult =
  | { ok: true; value: NorthwestSnapshot }
  | { ok: false; error: NorthwestSnapshotError };
const failure = (detail: string): SnapshotResult => ({
  ok: false,
  error: {
    tag: "NorthwestSnapshotError",
    operation: "frozen-claim assessment",
    detail: `${detail}. No candidates were returned. Prior inventory is preserved. Correct the frozen input and rerun assessment.`,
  },
});
type Groups = Map<string, Set<number>>;
const add = (groups: Groups, key: string, index: number) => {
  const indices = groups.get(key) ?? new Set<number>();
  indices.add(index);
  groups.set(key, indices);
};

/** Pure native-claim assessment. This does not establish enumeration, closing,
 * source qualification, admission, transport compatibility or enablement. */
function assess(
  input: unknown,
  location: NorthwestLocation,
  evidenceKind: NorthwestSnapshot["evidenceKind"],
): SnapshotResult {
  const parsed = z.array(NorthwestRecord.schema).safeParse(input);
  if (!parsed.success)
    return failure(`Invalid Northwest frozen claims: ${parsed.error.message}`);
  const geography = NorthwestLocationSchema.safeParse(location);
  if (!geography.success)
    return failure(
      `Invalid caller-supplied Northwest location: ${geography.error.message}`,
    );
  const records = parsed.data;
  if (
    new Set(records.map((record) => record.occurrenceId)).size !==
    records.length
  )
    return failure(
      "Northwest frozen occurrences repeat an occurrenceId; each original appearance needs a distinct ID",
    );
  const assessments = records.map((record) => NorthwestRecord.assess(record));
  const vins: Groups = new Map(),
    destinations: Groups = new Map();
  const quarantine = new Set<number>();
  assessments.forEach((row, index) => {
    for (const vin of row.validVinClaims) add(vins, vin, index);
    for (const destination of row.nativeClaims.destinations)
      if (destination.trim()) add(destinations, destination, index);
    if (
      row.reasons.includes("conflicting-native-required-claims") ||
      row.validVinClaims.length > 1
    )
      quarantine.add(index);
  });
  const conflicts: NorthwestSnapshot["conflicts"] = [];
  for (const [domain, groups] of [
    ["vin", vins],
    ["destination", destinations],
  ] as const) {
    for (const [value, indices] of groups) {
      const claims = {
        years: new Set<string>(),
        makeModels: new Set<string>(),
        vins: new Set<string>(),
        destinations: new Set<string>(),
      };
      for (const index of indices) {
        const row = assessments[index];
        if (!row)
          return failure(
            `Northwest ${domain} group ${value} references missing occurrence index ${index}`,
          );
        for (const key of [
          "years",
          "makeModels",
          "vins",
          "destinations",
        ] as const)
          for (const claim of row.nativeClaims[key])
            if (claim.trim()) claims[key].add(claim);
      }
      if (Object.values(claims).some((values) => values.size > 1)) {
        conflicts.push({ domain, value, recordIndices: [...indices] });
        for (const index of indices) quarantine.add(index);
      }
    }
  }
  // A conflict can bridge several VIN and destination groups. Visit each group
  // once so no occurrence wins merely because it appeared first.
  const pending = [...quarantine];
  const visitedVins = new Set<string>(),
    visitedDestinations = new Set<string>();
  for (let offset = 0; offset < pending.length; offset++) {
    const index = pending[offset];
    const row = index === undefined ? undefined : assessments[index];
    if (!row)
      return failure(
        `Northwest quarantine references missing occurrence index ${index}`,
      );
    for (const [values, groups, visited] of [
      [row.validVinClaims, vins, visitedVins],
      [row.nativeClaims.destinations, destinations, visitedDestinations],
    ] as const)
      for (const value of values) {
        if (visited.has(value)) continue;
        visited.add(value);
        for (const member of groups.get(value) ?? []) {
          if (quarantine.has(member)) continue;
          quarantine.add(member);
          pending.push(member);
        }
      }
  }
  const candidates = new Map<string, NorthwestCandidate>();
  const optionalRecords = new Map<string, NorthwestRecord[]>();
  const observed = new Set(assessments.flatMap((row) => row.validVinClaims));
  const occurrences: Occurrence[] = [];
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const [index, assessment] of assessments.entries()) {
    const { record } = assessment;
    if (assessment.status === "required-reject" || quarantine.has(index)) {
      accounting.recordsRejected++;
      const reasons: (
        | NorthwestRejectionReason
        | "connected-native-identity-conflict"
      )[] = [...assessment.reasons];
      if (quarantine.has(index))
        reasons.push("connected-native-identity-conflict");
      occurrences.push({
        occurrenceId: record.occurrenceId,
        status: "rejected",
        reasons,
      });
      continue;
    }
    const transformed = transformNorthwestRecord(record, geography.data);
    if (transformed.status === "rejected")
      return failure(
        `Northwest occurrence ${record.occurrenceId} changed assessment during pure transformation`,
      );
    const { candidate } = transformed;
    const duplicate = candidates.has(candidate.vin);
    if (duplicate) accounting.duplicateVehicles++;
    else candidates.set(candidate.vin, candidate);
    occurrences.push({
      occurrenceId: record.occurrenceId,
      status: duplicate ? "duplicate" : "candidate",
      vin: candidate.vin,
    });
    const appearances = optionalRecords.get(candidate.vin) ?? [];
    appearances.push(record);
    optionalRecords.set(candidate.vin, appearances);
  }
  const optionalConflicts: NorthwestSnapshot["optionalConflicts"] = [];
  for (const [vin, candidate] of candidates) {
    const appearances = optionalRecords.get(vin);
    if (!appearances)
      return failure(
        `Northwest candidate ${vin} lost its native optional claims`,
      );
    // Merge raw optional claims before validating metadata, so a malformed or
    // conflicting value cannot be hidden by the first accepted appearance.
    const merged = appearances[0];
    if (!merged)
      return failure(`Northwest candidate ${vin} has no native occurrence`);
    const record = { ...merged };
    for (const [, claims] of NorthwestOptionalFields)
      record[claims] = appearances.flatMap((appearance) =>
        claims === "imageUrls"
          ? appearance.imageUrls
              .filter((literal) => literal.trim())
              .map(
                (literal) =>
                  northwestOptionalValue(
                    "imageUrl",
                    literal,
                    appearance.sourceUrl,
                  ) ?? literal,
              )
          : appearance[claims],
      );
    const transformed = transformNorthwestRecord(record, geography.data);
    if (transformed.status === "rejected")
      return failure(
        `Northwest candidate ${vin} changed identity while merging optional claims`,
      );
    for (const [field] of NorthwestOptionalFields)
      candidate[field] = transformed.candidate[field];
    for (const conflict of transformed.optionalConflicts)
      optionalConflicts.push({ vin, ...conflict });
  }
  const total = accounting.recordsProcessed;
  if (
    candidates.size +
      accounting.recordsRejected +
      accounting.duplicateVehicles +
      accounting.recordsExcluded !==
      total ||
    occurrences.length !== total
  )
    return failure("Northwest frozen occurrence accounting does not reconcile");
  const rejectionRatio = total ? accounting.recordsRejected / total : null;
  const duplicateRatio = total ? accounting.duplicateVehicles / total : null;
  const issues: NorthwestSnapshot["quality"]["issues"] = [];
  if (!total) issues.push("empty-frozen-occurrences");
  if (
    rejectionRatio !== null &&
    rejectionRatio > SourceValidationPolicy.maximumRejectionRatio
  )
    issues.push("rejection-ratio-exceeded");
  if (
    duplicateRatio !== null &&
    duplicateRatio > SourceValidationPolicy.maximumDuplicateRatio
  )
    issues.push("duplicate-ratio-exceeded");
  return {
    ok: true,
    value: {
      evidenceKind,
      candidates: [...candidates.values()],
      observedVins: [...observed].sort(),
      assessments,
      occurrences,
      accounting,
      conflicts,
      optionalConflicts,
      quarantinedRecordIndices: [...quarantine].sort((a, b) => a - b),
      quality: { denominator: total, rejectionRatio, duplicateRatio, issues },
    },
  };
}

export const NorthwestSnapshot = {
  create(input: unknown, location: NorthwestLocation): SnapshotResult {
    const parsed = FrozenSchema.safeParse(input);
    if (!parsed.success)
      return failure(
        `Invalid Northwest frozen claims: ${parsed.error.message}`,
      );
    return assess(parsed.data.records, location, "browserDOM");
  },
  // Claims from the validated native HTML parser share every identity guard.
  fromNativeRecords(
    records: NorthwestRecord[],
    location: NorthwestLocation,
  ): SnapshotResult {
    return assess(records, location, "nativeHTML");
  },
} as const;
