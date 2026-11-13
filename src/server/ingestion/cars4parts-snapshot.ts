import type { ConnectorChunkAccounting } from "./connector-chunk";
import { z } from "zod";
import type { Cars4PartsContract } from "./cars4parts-contract";
import type { Cars4PartsPage } from "./cars4parts-parser";
import {
  Cars4PartsRecord,
  cars4partsBranch,
  cars4partsClaimKey,
  type Cars4PartsRecord as NativeRecord,
} from "./cars4parts-record";
import { Cars4PartsResult } from "./cars4parts-result";
import { SourceValidationPolicy } from "./source-validation";
import {
  cars4partsOptional,
  transformCars4PartsRecord,
  type Cars4PartsCanonicalVehicle,
} from "./cars4parts-transform";

export const Cars4PartsPreviousInventorySchema = z
  .object({
    heyworth: z.number().int().nonnegative().nullable(),
    armington: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type Cars4PartsPreviousInventory = z.infer<
  typeof Cars4PartsPreviousInventorySchema
>;
const emptyAccounting = (): ConnectorChunkAccounting => ({
  recordsProcessed: 0,
  recordsRejected: 0,
  recordsExcluded: 0,
  duplicateVehicles: 0,
});
const keys = ["heyworth", "armington"] as const;
const optionalKeys = [
  "stockNumber",
  "color",
  "imageUrl",
  "availableDate",
] as const;
type Group = Map<string, Set<number>>;
const add = (groups: Group, key: string, index: number) => {
  const group = groups.get(key) ?? new Set<number>();
  group.add(index);
  groups.set(key, group);
};

export function cars4partsSnapshot(
  pages: readonly Cars4PartsPage[],
  details: readonly NativeRecord[],
  makes: readonly string[],
  contract: Cars4PartsContract,
) {
  const rows = pages.flatMap((page) => page.rows);
  const uniqueDestinations = [...new Set(rows.map((row) => row.destination))];
  if (
    uniqueDestinations.length !== details.length ||
    uniqueDestinations.some(
      (destination, index) => destination !== details[index]?.destination,
    )
  )
    throw new Error(
      "Native leaf evidence does not account for every unique published result destination in order",
    );
  const byDestination = new Map(
    details.map((record) => [record.destination, record]),
  );
  const records = rows.map((row) => {
    const record = byDestination.get(row.destination);
    if (!record) throw new Error("Published result lost its native detail");
    return record;
  });
  const assessments = records.map((record, index) => {
    const row = rows[index];
    if (!row) throw new Error("Native leaf lost its published row context");
    const assessed = Cars4PartsRecord.assess(record, makes);
    const reasons = [...assessed.reasons];
    if (
      record.titles.some(
        (title) => cars4partsClaimKey(title) !== cars4partsClaimKey(row.ymm),
      )
    )
      reasons.push("conflicting-result-detail-ymm");
    if (record.branches.some((branch) => branch !== row.branch))
      reasons.push("conflicting-result-detail-branch");
    if (assessed.role === "unresolved")
      reasons.push("unresolved-native-listing-role");
    return { ...assessed, reasons: [...new Set(reasons)] };
  });
  const vinGroups: Group = new Map(),
    destinationGroups: Group = new Map();
  const quarantine = new Set<number>();
  assessments.forEach((assessed, index) => {
    for (const vin of assessed.validVinClaims) add(vinGroups, vin, index);
    for (const destination of [
      assessed.record.destination,
      ...assessed.record.canonicalClaims,
    ])
      add(destinationGroups, destination, index);
    if (assessed.reasons.some((reason) => reason.startsWith("conflicting-")))
      quarantine.add(index);
  });
  const conflicts: {
    domain: "vin" | "destination";
    value: string;
    indices: number[];
  }[] = [];
  for (const [domain, groups] of [
    ["vin", vinGroups],
    ["destination", destinationGroups],
  ] as const) {
    for (const [value, indices] of groups) {
      const signatures = new Set<string>();
      for (const index of indices) {
        const row = assessments[index];
        if (!row)
          throw new Error("Native conflict group references a missing detail");
        signatures.add(
          JSON.stringify([
            row.year,
            row.make === null ? null : cars4partsClaimKey(row.make),
            row.model === null ? null : cars4partsClaimKey(row.model),
            row.branch,
            row.record.destination,
            row.validVinClaims,
            row.role,
          ]),
        );
      }
      if (signatures.size > 1) {
        conflicts.push({ domain, value, indices: [...indices] });
        for (const index of indices) quarantine.add(index);
      }
    }
  }
  let before = -1;
  while (before !== quarantine.size) {
    before = quarantine.size;
    for (const groups of [vinGroups, destinationGroups])
      for (const indices of groups.values())
        if ([...indices].some((index) => quarantine.has(index)))
          for (const index of indices) quarantine.add(index);
  }
  const accounting = emptyAccounting();
  const perYard = { heyworth: emptyAccounting(), armington: emptyAccounting() };
  const unallocatedIndices: number[] = [],
    rejectedIndices: number[] = [],
    excludedIndices: number[] = [];
  const vehicles = new Map<string, Cars4PartsCanonicalVehicle>(),
    observed = new Set<string>();
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], string[]>
  >();
  const nativeMetadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], string[]>
  >();
  assessments.forEach((assessed, index) => {
    accounting.recordsProcessed++;
    const nativeRow = rows[index];
    const branch = nativeRow ? cars4partsBranch(nativeRow.branch) : null;
    if (branch === null) {
      unallocatedIndices.push(index);
      for (const vin of assessed.validVinClaims) observed.add(vin);
      return;
    }
    const yard = perYard[branch];
    yard.recordsProcessed++;
    if (assessed.role === "retail") {
      accounting.recordsExcluded++;
      yard.recordsExcluded++;
      excludedIndices.push(index);
      return;
    }
    const transformed = transformCars4PartsRecord(
      assessed.record,
      makes,
      contract[branch].yard,
    );
    if (
      assessed.reasons.length ||
      quarantine.has(index) ||
      transformed.status !== "available"
    ) {
      accounting.recordsRejected++;
      yard.recordsRejected++;
      rejectedIndices.push(index);
      for (const vin of assessed.validVinClaims) observed.add(vin);
      return;
    }
    const vehicle = transformed.vehicle;
    const values = metadata.get(vehicle.vin) ?? {
      stockNumber: [],
      color: [],
      imageUrl: [],
      availableDate: [],
    };
    for (const key of optionalKeys)
      if (vehicle[key] !== null) values[key].push(vehicle[key]);
    metadata.set(vehicle.vin, values);
    const claims = nativeMetadata.get(vehicle.vin) ?? {
      stockNumber: [],
      color: [],
      imageUrl: [],
      availableDate: [],
    };
    claims.stockNumber.push(
      ...assessed.record.stock,
      ...(nativeRow?.stock ? [nativeRow.stock] : []),
    );
    claims.color.push(...assessed.record.colors);
    claims.imageUrl.push(
      ...assessed.record.images,
      ...(nativeRow?.image ? [nativeRow.image] : []),
    );
    nativeMetadata.set(vehicle.vin, claims);
    if (vehicles.has(vehicle.vin)) {
      accounting.duplicateVehicles++;
      yard.duplicateVehicles++;
    } else vehicles.set(vehicle.vin, { ...vehicle });
  });
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    const claims = nativeMetadata.get(vin);
    if (!values || !claims)
      throw new Error("Accepted native VIN lost its optional metadata group");
    for (const key of optionalKeys)
      vehicle[key] =
        new Set(claims[key].filter(Boolean)).size > 1
          ? null
          : cars4partsOptional(values[key]);
  }
  const acceptedByYard = { heyworth: 0, armington: 0 };
  for (const vehicle of vehicles.values()) {
    if (vehicle.locationCode === "heyworth") acceptedByYard.heyworth++;
    else if (vehicle.locationCode === "armington") acceptedByYard.armington++;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observed].sort(),
    accounting,
    perYard,
    acceptedByYard,
    assessments,
    conflicts,
    rejectedIndices,
    excludedIndices,
    unallocatedIndices,
    quarantinedIndices: [...quarantine].sort((a, b) => a - b),
  };
}
export type Cars4PartsSnapshot = ReturnType<typeof cars4partsSnapshot>;
export function validateCars4PartsSnapshot(
  snapshot: Cars4PartsSnapshot,
  contract: Cars4PartsContract,
  previous: Cars4PartsPreviousInventory,
) {
  const reasons: string[] = [];
  const reconciles = (accounting: ConnectorChunkAccounting, accepted: number) =>
    accepted +
      accounting.recordsRejected +
      accounting.recordsExcluded +
      accounting.duplicateVehicles ===
    accounting.recordsProcessed;
  if (
    snapshot.unallocatedIndices.length ||
    !reconciles(snapshot.accounting, snapshot.vehicles.length)
  )
    reasons.push(
      "source observations are unallocated or accounting does not reconcile",
    );
  for (const branch of keys) {
    const accepted = snapshot.acceptedByYard[branch],
      accounting = snapshot.perYard[branch];
    const candidate = accounting.recordsProcessed - accounting.recordsExcluded;
    if (!reconciles(accounting, accepted))
      reasons.push(branch + " accounting does not reconcile");
    if (accepted < contract[branch].minimumUniqueInventory)
      reasons.push(
        `${branch} accepted ${accepted} is below root-supplied minimum ${contract[branch].minimumUniqueInventory}`,
      );
    if (
      candidate > 0 &&
      accounting.recordsRejected / candidate >
        SourceValidationPolicy.maximumRejectionRatio
    )
      reasons.push(branch + " required rejection exceeds 10%");
    if (
      candidate > 0 &&
      accounting.duplicateVehicles / candidate >
        SourceValidationPolicy.maximumDuplicateRatio
    )
      reasons.push(branch + " benign duplicates exceed 25%");
    const prior = previous[branch];
    if (
      prior !== null &&
      accepted < prior * SourceValidationPolicy.minimumPreviousRunRatio
    )
      reasons.push(
        branch +
          " accepted inventory fell below 50% of the previous complete run",
      );
  }
  return reasons.length
    ? ({
        ok: false,
        error: Cars4PartsResult.error(
          "complete-source validation",
          reasons.join("; "),
        ),
      } as const)
    : ({ ok: true, value: snapshot } as const);
}
