import type { ConnectorChunkAccounting } from "./connector-chunk";
import { SourceValidationPolicy } from "./source-validation";
import type { PrattContract } from "./pratt-contract";
import type { PrattPage } from "./pratt-parser";
import { PrattRecord, type PrattControl } from "./pratt-record";
import { PrattResult } from "./pratt-result";
import {
  transformPrattRecord,
  type PrattCanonicalVehicle,
} from "./pratt-transform";

export interface PrattModelMenu {
  make: PrattControl;
  models: PrattControl[];
}
export const prattModels = (menus: readonly PrattModelMenu[]) =>
  menus.flatMap((menu) =>
    menu.models.map((model) => ({ make: menu.make, model })),
  );
type Groups = Map<string, Set<number>>;
const add = (groups: Groups, key: string, index: number) => {
  const group = groups.get(key) ?? new Set<number>();
  group.add(index);
  groups.set(key, group);
};

/** Assess and quarantine connected native claims before canonical make display
 * normalization. Optional disagreements are merged to null after acceptance. */
export function prattSnapshot(
  pages: readonly PrattPage[],
  arrivals: PrattPage,
  menus: readonly PrattModelMenu[],
  contract: PrattContract,
) {
  const published = prattModels(menus);
  const rows = [
    ...pages.flatMap((page) =>
      page.records.map((record) => ({ record, context: page.context })),
    ),
    ...arrivals.records.map((record) => ({
      record,
      context: arrivals.context,
    })),
  ];
  const assessments = rows.map(({ record, context }) =>
    PrattRecord.assess(record, context, published),
  );
  const vins: Groups = new Map(),
    destinations: Groups = new Map();
  const quarantine = new Set<number>();
  assessments.forEach((row, index) => {
    for (const vin of row.validVinClaims) add(vins, vin, index);
    for (const destination of row.nativeClaims.destinations)
      add(destinations, destination, index);
    if (
      row.reasons.includes("conflicting-native-required-claims") ||
      row.validVinClaims.length > 1 ||
      row.nativeClaims.destinations.length > 1
    )
      quarantine.add(index);
  });
  const conflicts: {
    domain: "vin" | "destination";
    value: string;
    recordIndices: number[];
  }[] = [];
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
          throw new Error(
            "Pratt native conflict group references a missing assessed row",
          );
        for (const key of [
          "years",
          "makeModels",
          "vins",
          "destinations",
        ] as const)
          for (const claim of row.nativeClaims[key])
            if (claim.trim())
              claims[key].add(key === "vins" ? claim.toUpperCase() : claim);
      }
      if (Object.values(claims).some((group) => group.size > 1)) {
        conflicts.push({ domain, value, recordIndices: [...indices] });
        for (const index of indices) quarantine.add(index);
      }
    }
  }
  let previous = -1;
  while (previous !== quarantine.size) {
    previous = quarantine.size;
    for (const groups of [vins, destinations])
      for (const indices of groups.values())
        if ([...indices].some((index) => quarantine.has(index)))
          for (const index of indices) quarantine.add(index);
  }
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: rows.length,
    recordsRejected: 0,
    duplicateVehicles: 0,
    recordsExcluded: 0,
  };
  const vehicles = new Map<string, PrattCanonicalVehicle>(),
    observedVins = new Set<string>();
  const optionalKeys = ["stockNumber", "imageUrl", "availableDate"] as const;
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], Set<string>>
  >();
  rows.forEach(({ record, context }, index) => {
    const assessment = assessments[index];
    if (!assessment)
      throw new Error("Pratt native row lost its required-identity assessment");
    if (assessment.reasons.length || quarantine.has(index)) {
      accounting.recordsRejected++;
      for (const vin of assessment.validVinClaims) observedVins.add(vin);
      return;
    }
    const result = transformPrattRecord(
      record,
      context,
      contract.yard,
      published,
    );
    if (result.status === "rejected") {
      accounting.recordsRejected++;
      for (const vin of result.validVinClaims) observedVins.add(vin);
      return;
    }
    const vehicle = result.vehicle;
    const values = metadata.get(vehicle.vin) ?? {
      stockNumber: new Set<string>(),
      imageUrl: new Set<string>(),
      availableDate: new Set<string>(),
    };
    for (const key of optionalKeys)
      if (vehicle[key] !== null) values[key].add(vehicle[key]);
    metadata.set(vehicle.vin, values);
    if (vehicles.has(vehicle.vin)) accounting.duplicateVehicles++;
    else vehicles.set(vehicle.vin, { ...vehicle });
  });
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values)
      throw new Error("Pratt accepted VIN lost its optional metadata group");
    for (const key of optionalKeys)
      vehicle[key] =
        values[key].size === 1 ? ([...values[key]][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    accounting,
    conflicts,
    quarantinedRecordIndices: [...quarantine].sort(
      (left, right) => left - right,
    ),
    assessments,
  };
}
export type PrattSnapshot = ReturnType<typeof prattSnapshot>;
export function validatePrattSnapshot(
  snapshot: PrattSnapshot,
  contract: PrattContract,
  previousUniqueInventory: number | null,
) {
  const { accounting, vehicles } = snapshot;
  const total = accounting.recordsProcessed;
  const reasons: string[] = [];
  if (
    vehicles.length +
      accounting.recordsRejected +
      accounting.duplicateVehicles !==
    total
  )
    reasons.push("native union accounting does not reconcile");
  if (vehicles.length < contract.minimumUniqueInventory)
    reasons.push(
      `accepted inventory ${vehicles.length} is below root-supplied minimum ${contract.minimumUniqueInventory}`,
    );
  if (
    total > 0 &&
    accounting.recordsRejected / total >
      SourceValidationPolicy.maximumRejectionRatio
  )
    reasons.push("required rejection exceeds 10%");
  if (
    total > 0 &&
    accounting.duplicateVehicles / total >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    reasons.push("benign duplicates exceed 25%");
  if (
    previousUniqueInventory !== null &&
    vehicles.length <
      previousUniqueInventory * SourceValidationPolicy.minimumPreviousRunRatio
  )
    reasons.push(
      "accepted inventory fell below 50% of the previous complete run",
    );
  return reasons.length
    ? ({
        ok: false,
        error: PrattResult.error(
          "complete-source validation",
          reasons.join("; "),
        ),
      } as const)
    : ({ ok: true, value: snapshot } as const);
}
