/**
 * How a VIN was first seen. `yard_backfill` VINs came with their yard's
 * first published crawl (its `yard_arrival_baseline` did not exist yet): the
 * inventory a new yard or provider already had, never an arrival. `arrival`
 * VINs were first seen at a yard that was already published, dated or not.
 *
 * Reconciliation decides it once, when it first plans the VIN, and stores it
 * on the vehicle row. A handoff to another source or yard and a relist keep
 * it, the same way they keep `firstSeenAt`.
 */
export type FirstSighting = (typeof values)[number];

const values = ["yard_backfill", "arrival"] as const;

/** The search record attribute, a filter-only facet. */
const attribute = "firstSighting";

/** A VIN no row or recent departure has seen before. */
function ofNewVin(yardPublished: "published" | "unpublished"): FirstSighting {
  return yardPublished === "published" ? "arrival" : "yard_backfill";
}

/**
 * Excludes yard backfill. Records projected before the attribute existed lack
 * it and still match, so deploying this needs no index rebuild.
 */
const arrivalsFilter = `NOT ${attribute}:"yard_backfill"`;

export const FirstSighting = {
  values,
  attribute,
  ofNewVin,
  arrivalsFilter,
} as const;
