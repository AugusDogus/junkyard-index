import { ArrivalDate } from "~/lib/arrival-date";
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
  "rtp",
  "nvpap",
  "pontiac",
  "aero",
  "vanderhaags",
  "chesterfield",
  "utpap",
  "tritown",
  "whitebradstreet",
  "midway",
  "rightway",
  "ddauto",
  "rivervalley",
  "fenix",
  "importapart",
  "army",
  "idipull",
  "bigd",
  "pullsavewa",
  "littleton",
  "michigantruck",
  "joliet",
  "alln1",
  "grandpajohns",
  "pickers",
  "pipes",
  "uwrench",
  "millerstown",
  "pickapartva",
  "mccauley",
  "rustyhook",
  "aviation",
  "chaz",
  "citymotors",
  "awap",
  "clearsalvage",
  "aplus",
  "central",
  "northwest",
  "coutu",
  "kodak",
  "six03",
  "rohner",
  "pratt",
  "cars4parts",
  "meeks",
  "brandywine",
  "rmmdtp",
  "calton",
  "bigtruckpage",
  "speedys",
  "sandw",
  "denton",
  "beavers",
  "indianriver",
  "scotts",
  "oem",
  "dutchers",
  "alsauto",
  "chasencars",
  "weberbrothers",
  "hawaiiparts",
  "modernmuscle",
  "carsandparts",
  "spartan",
  "oemgarage",
  "hagerman",
  "kandr",
  "jimsimport",
  "lonestarimports",
  "alshned",
  "hollanderstores",
  "cstruck",
  "allied",
  "byot",
  "heavytruckparts",
  "vinplus",
  "urgiis",
  "harrys",
  "budget",
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
    existing.sourceMake !== (next.sourceMake ?? null) ||
    existing.sourceModel !== (next.sourceModel ?? null) ||
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

/** A VIN listed again within this long of its departure is a relist. */
export const RELIST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** A recorded departure of a VIN the run lists but has no vehicle row for. */
export interface RecentDeparture {
  vin: string;
  source: string;
  locationCode: string;
  firstSeenAt: Date;
  departedAt: Date;
}

/**
 * The latest departure of the same VIN from the same yard within the relist
 * window: the listing came back, so it is not a new arrival.
 */
function relistedDeparture(
  next: CanonicalVehicle,
  departures: readonly RecentDeparture[],
  runTimestamp: Date,
): RecentDeparture | null {
  const windowStart = runTimestamp.getTime() - RELIST_WINDOW_MS;
  let latest: RecentDeparture | null = null;
  for (const departure of departures) {
    if (
      departure.vin === next.vin &&
      departure.source === next.source &&
      departure.locationCode === next.locationCode &&
      departure.departedAt.getTime() >= windowStart &&
      (latest === null ||
        departure.departedAt.getTime() > latest.departedAt.getTime())
    )
      latest = departure;
  }
  return latest;
}

export function planChangedVehicleUpserts(params: {
  inventory: ReadonlyMap<string, CanonicalVehicle>;
  existingRows: readonly ExistingVehicle[];
  /** Departures of listed VINs that have no vehicle row. */
  recentDepartures: readonly RecentDeparture[];
  runTimestamp: Date;
  acceptedSources: ReadonlySet<string>;
  publishedYards: ReadonlyMap<string, ReadonlySet<string>>;
}) {
  const existingByVin = new Map(
    params.existingRows.map((row) => [row.vin, row] as const),
  );
  const changed: Array<{
    vehicle: CanonicalVehicle;
    firstSeenAt: Date;
    observedArrivalAt: Date | null;
  }> = [];
  for (const [vin, next] of params.inventory) {
    const existing = existingByVin.get(vin);
    if (keptByHigherPriorityOwner(existing, next, params.acceptedSources))
      continue;
    if (!vehicleNeedsUpsert(existing, next)) continue;
    if (existing) {
      changed.push({
        vehicle: next,
        firstSeenAt: existing.firstSeenAt,
        observedArrivalAt: existing.observedArrivalAt,
      });
      continue;
    }
    const relisted = relistedDeparture(
      next,
      params.recentDepartures,
      params.runTimestamp,
    );
    changed.push(
      relisted
        ? // A relist keeps its listing's first sighting and is no arrival.
          {
            vehicle: next,
            firstSeenAt: relisted.firstSeenAt,
            observedArrivalAt: null,
          }
        : {
            vehicle: next,
            firstSeenAt: params.runTimestamp,
            observedArrivalAt:
              ArrivalDate.from(next.availableDate, null).kind === "unknown" &&
              params.publishedYards.get(next.source)?.has(next.locationCode)
                ? params.runTimestamp
                : null,
          },
    );
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
      // Only an earlier run sets missingSinceAt, so a vehicle still missing
      // after deleteAfterMs was missed on at least two ingestion days. Run
      // counts are not used: same-day retries and re-crawls inflate them.
      changeType: missingSinceAt <= cutoff ? "delete" : "missing",
      missingSinceAt,
      missingRunCount,
    });
  }
  return transitions;
}
