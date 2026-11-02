import { vehicle } from "~/schema";
import type { CanonicalVehicle } from "./types";

type SourceName = CanonicalVehicle["source"];
type ExistingVehicle = typeof vehicle.$inferSelect;

export const RECONCILIATION_SOURCE_PRIORITY: readonly SourceName[] = [
  "row52",
  "pyp",
  "pullapart",
  "upullitne",
  "upullitdavie",
  "gopullit",
  "pullnsave",
  "tearapart",
  "wrenchapart",
  "upullrparts",
  "ipullupull",
  "upullitwa",
  "partsgalore",
  "autorecycler",
];

/** The rank reconciliationSourcePrioritySql assigns: 1 is highest. */
export function reconciliationSourcePriority(source: string): number {
  const index = RECONCILIATION_SOURCE_PRIORITY.findIndex(
    (candidate) => candidate === source,
  );
  return index < 0 ? 999 : index + 1;
}

export function reconciliationSourcePrioritySql(tableAlias: string): string {
  const branches = RECONCILIATION_SOURCE_PRIORITY.map(
    (source, index) => `when '${source}' then ${index + 1}`,
  ).join("\n    ");
  return `case ${tableAlias}.source
    ${branches}
    else 999
  end`;
}

// Turso's HTTP API returns REAL values rounded to 15 significant digits, so a
// stored coordinate can differ from the provider's by float noise. 1e-9
// degrees is under a millimetre.
const COORDINATE_TOLERANCE = 1e-9;

function sameCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) <= COORDINATE_TOLERANCE;
}

function vehicleNeedsUpsert(
  existing: ExistingVehicle | undefined,
  next: CanonicalVehicle,
): boolean {
  if (!existing) return true;
  return (
    existing.source !== next.source ||
    existing.year !== next.year ||
    existing.make !== next.make ||
    existing.model !== next.model ||
    existing.color !== next.color ||
    existing.stockNumber !== next.stockNumber ||
    existing.imageUrl !== next.imageUrl ||
    existing.availableDate !== next.availableDate ||
    existing.locationCode !== next.locationCode ||
    existing.locationName !== next.locationName ||
    existing.locationCity !== next.locationCity ||
    existing.state !== next.state ||
    existing.stateAbbr !== next.stateAbbr ||
    !sameCoordinate(existing.lat, next.lat) ||
    !sameCoordinate(existing.lng, next.lng) ||
    existing.section !== next.section ||
    existing.row !== next.row ||
    existing.space !== next.space ||
    existing.detailsUrl !== next.detailsUrl ||
    existing.partsUrl !== next.partsUrl ||
    existing.pricesUrl !== next.pricesUrl ||
    existing.engine !== next.engine ||
    existing.trim !== next.trim ||
    existing.transmission !== next.transmission ||
    existing.missingSinceAt !== null ||
    (existing.missingRunCount ?? 0) !== 0
  );
}

/**
 * Runs reconcile only their own sources, so a VIN another source still lists
 * keeps the higher-priority listing. The owner's own runs retire it when it
 * stops listing the VIN; until then a lower-priority source cannot take it.
 */
function keptByHigherPriorityOwner(
  existing: ExistingVehicle | undefined,
  next: CanonicalVehicle,
  acceptedSources: ReadonlySet<string>,
): boolean {
  return (
    existing !== undefined &&
    existing.missingSinceAt === null &&
    !acceptedSources.has(existing.source) &&
    reconciliationSourcePriority(existing.source) <
      reconciliationSourcePriority(next.source)
  );
}

export function planChangedVehicleUpserts(params: {
  inventory: ReadonlyMap<string, CanonicalVehicle>;
  existingRows: readonly ExistingVehicle[];
  runTimestamp: Date;
  acceptedSources: ReadonlySet<string>;
}) {
  const existingByVin = new Map(
    params.existingRows.map((row) => [row.vin, row] as const),
  );
  const changed: Array<{ vehicle: CanonicalVehicle; firstSeenAt: Date }> = [];
  for (const [vin, next] of params.inventory) {
    const existing = existingByVin.get(vin);
    if (keptByHigherPriorityOwner(existing, next, params.acceptedSources))
      continue;
    if (!vehicleNeedsUpsert(existing, next)) continue;
    changed.push({
      vehicle: next,
      firstSeenAt: existing?.firstSeenAt ?? params.runTimestamp,
    });
  }
  return changed;
}

export interface MissingVehicleTransition {
  vin: string;
  changeType: "missing" | "delete";
  missingSinceAt: number;
  missingRunCount: number;
}

export function planMissingVehicleTransitions(params: {
  presentVins: ReadonlySet<string>;
  existingRows: ReadonlyArray<{
    vin: string;
    source: string;
    missingSinceAt: Date | null;
    missingRunCount: number | null;
  }>;
  runTimestamp: Date;
  acceptedSources: ReadonlySet<string>;
  deleteAfterRuns: number;
  deleteAfterMs: number;
}): MissingVehicleTransition[] {
  const cutoff = params.runTimestamp.getTime() - params.deleteAfterMs;
  const transitions: MissingVehicleTransition[] = [];
  for (const row of params.existingRows) {
    if (
      !params.acceptedSources.has(row.source) ||
      params.presentVins.has(row.vin)
    ) {
      continue;
    }
    const missingSinceAt =
      row.missingSinceAt?.getTime() ?? params.runTimestamp.getTime();
    const missingRunCount = (row.missingRunCount ?? 0) + 1;
    transitions.push({
      vin: row.vin,
      changeType:
        missingRunCount >= params.deleteAfterRuns || missingSinceAt <= cutoff
          ? "delete"
          : "missing",
      missingSinceAt,
      missingRunCount,
    });
  }
  return transitions;
}
