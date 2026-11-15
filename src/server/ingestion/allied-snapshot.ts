import { quarantineIisClaims } from "./iis-quarantine";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { SourceValidationPolicy } from "./source-validation";
import type { AlliedContract } from "./allied-contract";
import type { AlliedPage } from "./allied-parser";
import { AlliedRecord, type AlliedControl } from "./allied-record";
import { AlliedResult } from "./allied-result";
import {
  transformAlliedRecord,
  type AlliedCanonicalVehicle,
} from "./allied-transform";

export interface AlliedModelMenu {
  make: AlliedControl;
  models: AlliedControl[];
}
export const alliedModels = (menus: readonly AlliedModelMenu[]) =>
  menus.flatMap((menu) =>
    menu.models.map((model) => ({ make: menu.make, model })),
  );
/** Nonstandard stock records cannot be reliably identified, including some real
 * trucks. Exclude by the approved native stock rule, never by VIN presence. */
export const alliedDonorStock = (stock: string | null): boolean =>
  stock !== null && /^\d{1,2}[A-L]\d{3}$/.test(stock);

/** Assess and quarantine connected native claims before canonical make display
 * normalization. Optional disagreements are merged to null after acceptance. */
export function alliedSnapshot(
  pages: readonly AlliedPage[],
  arrivals: AlliedPage,
  menus: readonly AlliedModelMenu[],
  contract: AlliedContract,
) {
  const published = alliedModels(menus);
  const allRows = [
    ...pages.flatMap((page) =>
      page.records.map((record) => ({ record, context: page.context })),
    ),
    ...arrivals.records.map((record) => ({
      record,
      context: arrivals.context,
    })),
  ];
  const rows = allRows.filter(({ record }) => alliedDonorStock(record.stock));
  const assessments = rows.map(({ record, context }) =>
    AlliedRecord.assess(record, context, published),
  );
  const { quarantine, conflicts } = quarantineIisClaims(assessments);
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: allRows.length,
    recordsRejected: 0,
    duplicateVehicles: 0,
    recordsExcluded: allRows.length - rows.length,
  };
  const vehicles = new Map<string, AlliedCanonicalVehicle>(),
    observedVins = new Set<string>();
  const optionalKeys = ["stockNumber", "imageUrl", "availableDate"] as const;
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], Set<string>>
  >();
  rows.forEach(({ record, context }, index) => {
    const assessment = assessments[index];
    if (!assessment)
      throw new Error(
        "Allied native row lost its required-identity assessment",
      );
    if (assessment.reasons.length || quarantine.has(index)) {
      accounting.recordsRejected++;
      for (const vin of assessment.validVinClaims) observedVins.add(vin);
      return;
    }
    const result = transformAlliedRecord(
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
      throw new Error("Allied accepted VIN lost its optional metadata group");
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
export type AlliedSnapshot = ReturnType<typeof alliedSnapshot>;
export function validateAlliedSnapshot(
  snapshot: AlliedSnapshot,
  contract: AlliedContract,
  previousUniqueInventory: number | null,
) {
  const { accounting, vehicles } = snapshot;
  const total = accounting.recordsProcessed - accounting.recordsExcluded;
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
    reasons.push(
      `required rejection ${accounting.recordsRejected}/${total} exceeds 10%`,
    );
  if (
    total > 0 &&
    accounting.duplicateVehicles / total >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    reasons.push(
      `benign duplicates ${accounting.duplicateVehicles}/${total} exceed 25%`,
    );
  if (
    previousUniqueInventory !== null &&
    vehicles.length <
      previousUniqueInventory * SourceValidationPolicy.minimumPreviousRunRatio
  )
    reasons.push(
      `accepted inventory ${vehicles.length} fell below 50% of the previous complete run (${previousUniqueInventory})`,
    );
  return reasons.length
    ? ({
        ok: false,
        error: AlliedResult.error(
          "complete-source validation",
          reasons.join("; "),
        ),
      } as const)
    : ({ ok: true, value: snapshot } as const);
}
