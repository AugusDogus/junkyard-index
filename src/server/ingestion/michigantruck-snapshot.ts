import { createHash } from "node:crypto";
import type {
  MichigantruckCursor,
  MichigantruckSeen,
} from "./michigantruck-cursor";
import type { MichigantruckPage } from "./michigantruck-parser";
import {
  transformMichigantruckRecord,
  type MichigantruckCanonicalVehicle,
} from "./michigantruck-record";
import { SourceValidationPolicy } from "./source-validation";

export type MichigantruckProgress = Omit<
  Extract<MichigantruckCursor, { phase: "pages" }>,
  "source" | "phase" | "nextUrl"
>;
export function michigantruckProgressKey(p: MichigantruckProgress): string {
  return JSON.stringify([
    p.total,
    p.salvageTotal,
    p.retailTotal,
    p.processed,
    p.emitted,
    p.excluded,
    p.rejected,
    p.duplicates,
    p.seen,
    p.pages,
  ]);
}

export function appendMichigantruckPage(
  prior: MichigantruckProgress | null,
  page: MichigantruckPage,
  url: string,
) {
  const previous: MichigantruckProgress = prior ?? {
    total: page.total,
    salvageTotal: page.salvageTotal,
    retailTotal: page.retailTotal,
    processed: 0,
    emitted: 0,
    excluded: 0,
    rejected: 0,
    duplicates: 0,
    seen: [],
    pages: [],
  };
  if (
    page.total !== previous.total ||
    page.salvageTotal !== previous.salvageTotal ||
    page.retailTotal !== previous.retailTotal ||
    page.page !== previous.pages.length + 1 ||
    previous.pages.some((entry) => entry.hash === page.hash)
  )
    throw new Error(
      "Michigan Truck page scope, condition census or ordering changed",
    );
  const seen: MichigantruckSeen[] = [...previous.seen];
  const ids = new Set(seen.map((row) => row.id));
  const vins = new Set(
    seen.flatMap((row) => (row.vin === null ? [] : [row.vin])),
  );
  const accepted = new Map(
    seen.flatMap((row) =>
      row.status === "available" ? [[row.vin, row.identity] as const] : [],
    ),
  );
  const vehicles: MichigantruckCanonicalVehicle[] = [];
  const observedVins: string[] = [];
  let rejected = 0,
    excluded = 0,
    duplicates = 0;
  for (const record of page.records) {
    if (ids.has(record.id))
      throw new Error("Michigan Truck duplicate native donor ID " + record.id);
    ids.add(record.id);
    const result = transformMichigantruckRecord(record);
    if (result.status === "excluded") {
      excluded++;
      seen.push({
        id: record.id,
        status: "excluded",
        vin: null,
        identity: null,
      });
      continue;
    }
    if (result.status === "incomplete") {
      if (result.vin !== null && vins.has(result.vin))
        throw new Error(
          "Michigan Truck rejected donor reuses an observed native VIN " +
            result.vin,
        );
      rejected++;
      seen.push({
        id: record.id,
        status: "incomplete",
        vin: result.vin,
        identity: null,
      });
      if (result.vin !== null) {
        vins.add(result.vin);
        observedVins.push(result.vin);
      }
      continue;
    }
    const vehicle = result.vehicle;
    const identity = createHash("sha256")
      .update(
        JSON.stringify([
          vehicle.year,
          vehicle.make.toUpperCase(),
          vehicle.model.toUpperCase(),
        ]),
      )
      .digest("hex");
    const priorIdentity = accepted.get(vehicle.vin);
    if (vins.has(vehicle.vin) && priorIdentity !== identity)
      throw new Error(
        "Michigan Truck native VIN has conflicting donor identity " +
          vehicle.vin,
      );
    if (priorIdentity !== undefined) {
      duplicates++;
      seen.push({
        id: record.id,
        status: "duplicate",
        vin: vehicle.vin,
        identity,
      });
    } else {
      vehicles.push(vehicle);
      vins.add(vehicle.vin);
      accepted.set(vehicle.vin, identity);
      seen.push({
        id: record.id,
        status: "available",
        vin: vehicle.vin,
        identity,
      });
    }
  }
  const progress: MichigantruckProgress = {
    total: previous.total,
    salvageTotal: previous.salvageTotal,
    retailTotal: previous.retailTotal,
    processed: previous.processed + page.records.length,
    emitted: previous.emitted + vehicles.length,
    rejected: previous.rejected + rejected,
    excluded: previous.excluded + excluded,
    duplicates: previous.duplicates + duplicates,
    seen,
    pages: [...previous.pages, { url, hash: page.hash }],
  };
  if (
    progress.excluded > progress.retailTotal ||
    progress.processed - progress.excluded > progress.salvageTotal
  )
    throw new Error(
      "Michigan Truck observed conditions exceed their native facets",
    );
  return {
    progress,
    vehicles,
    observedVins,
    accounting: {
      recordsProcessed: page.records.length,
      recordsExcluded: excluded,
      recordsRejected: rejected,
      duplicateVehicles: duplicates,
    },
  };
}

export function validateMichigantruckCompletion(
  progress: MichigantruckProgress,
): void {
  if (
    progress.processed !== progress.total ||
    progress.excluded !== progress.retailTotal ||
    progress.processed - progress.excluded !== progress.salvageTotal ||
    progress.emitted < 1 ||
    progress.rejected / progress.salvageTotal >
      SourceValidationPolicy.maximumRejectionRatio ||
    progress.duplicates / progress.salvageTotal >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Michigan Truck terminal census or yard quality failed; retain the unchanged 10% required rejection and 25% duplicate limits, using Salvage rows only",
    );
}
