/**
 * How a vehicle was first seen, relative to its yard's arrival baseline (the
 * run that first published the yard). `yard_backfill` vehicles were first
 * seen no later than that run: the inventory a new yard or provider already
 * had, never an arrival. `arrival` vehicles were first seen by a later run,
 * dated or not. A relist keeps its listing's first sighting, and so its kind.
 */
export type FirstSighting = "yard_backfill" | "arrival";

/** The search record attribute, a filter-only facet. */
const attribute = "firstSighting";

/**
 * `yardEstablishedAt` is the yard's `yard_arrival_baseline.established_at`,
 * or null when no run has published the yard yet. Matches the homepage's
 * recent-vehicle rule (first seen after the baseline).
 */
function of(firstSeenAt: Date, yardEstablishedAt: Date | null): FirstSighting {
  return yardEstablishedAt === null ||
    firstSeenAt.getTime() <= yardEstablishedAt.getTime()
    ? "yard_backfill"
    : "arrival";
}

/**
 * Excludes yard backfill. Records projected before the attribute existed lack
 * it and still match, so deploying this needs no index rebuild.
 */
const arrivalsFilter = `NOT ${attribute}:"yard_backfill"`;

export const FirstSighting = { attribute, of, arrivalsFilter } as const;
