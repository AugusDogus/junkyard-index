import { transientRejection } from "./ingestion-validation";
import {
  pickapartvaCardKey,
  type PickapartvaRecord,
  type PickapartvaSearchResult,
} from "./pickapartva-parser";
import {
  PICKAPARTVA_MAX_MAKES,
  PICKAPARTVA_PAGE_SIZE,
  PICKAPARTVA_YARD_CODES,
  pickapartvaSearchHref,
  type PickapartvaSearchScope,
} from "./pickapartva-yard-metadata";

/** A Set Date whose donors the catalog repeated across pages, as one catalog
 * read saw it. */
export interface PickapartvaTie {
  date: string;
  /** Repeated catalog cards of this date. Each stands in for exactly one
   * donor of this date that no catalog page showed. */
  slots: number;
  /** Card keys of this date's donors the catalog showed, sorted. */
  shown: string[];
}

/** One native search for a Set Date: across every yard, within one yard, or
 * for one make within one yard. */
export interface PickapartvaSearchStep {
  id: PickapartvaSearchScope;
  /** `ANY`, or the one native make a split yard search selects. */
  make: string;
}
export interface PickapartvaRecoverySearch extends PickapartvaSearchStep {
  url: string;
  hash: string;
  /** Whether the search filled its one 500-card page. */
  capped: boolean;
}
/** A donor a search listed that no catalog page showed, with the search that
 * listed it. */
export interface PickapartvaHiddenDonor extends PickapartvaSearchStep {
  record: PickapartvaRecord;
}

/**
 * The searches that recover one tie date's hidden donors. Because the catalog
 * orders by Set Date, a date's donors fill one fixed run of slots, so with
 * the inventory unchanged exactly `slots` of them are hidden. Every donor a
 * search lists that the catalog did not show is one of them, so the date is
 * recovered once its searches list `slots` such donors, whether or not each
 * search was capped. Searches escalate from every yard to each yard to each
 * make of a capped yard, and stop as soon as the date is recovered.
 *
 * `startedAt` is when the catalog read that planned it ended; it bounds how
 * long its search results stand in for the current inventory.
 */
export interface PickapartvaRecovery extends PickapartvaTie {
  startedAt: number;
  searches: PickapartvaRecoverySearch[];
  hidden: PickapartvaHiddenDonor[];
  /** Searches still to run, in order. Empty once every hidden donor is
   * found. */
  pending: PickapartvaSearchStep[];
}

/** Saved search results stand in for the current inventory this long after
 * the catalog read that planned them. A recovery older than this is planned
 * again from a fresh catalog read. */
export const PICKAPARTVA_RECOVERY_LIFETIME_MS = 60 * 60_000;

const yards = (): PickapartvaSearchStep[] =>
  PICKAPARTVA_YARD_CODES.map((id) => ({ id, make: "ANY" }));

/** The native makes of a capped yard search, most listed donors first, so
 * the make searches most likely to hold its unlisted donors run first. Ties
 * keep the native selector's order. */
function splitMakes(
  date: string,
  id: PickapartvaSearchScope,
  makes: readonly string[],
  records: readonly PickapartvaRecord[],
): string[] {
  if (
    !makes.length ||
    makes.length > PICKAPARTVA_MAX_MAKES ||
    new Set(makes).size !== makes.length ||
    makes.some((make) => pickapartvaSearchHref(date, id, make) === null)
  )
    throw new Error(
      `Pick-A-Part VA native make selector for ${date} in ${id} is empty, repeated or offers a make outside the verified make path contract`,
    );
  const listed = (make: string) =>
    records.filter((record) => record.make === make).length;
  return makes
    .map((make, order) => ({ make, order, listed: listed(make) }))
    .sort((a, b) => b.listed - a.listed || a.order - b.order)
    .map(({ make }) => make);
}

const short = (recovery: PickapartvaRecovery, found: number) =>
  `Pick-A-Part VA set-date searches for ${recovery.date} add ${found} donors, but the catalog repeated ${recovery.slots} cards of that date; the inventory changed between reads, so completeness is unproven`;

export const PickapartvaRecovery = {
  /** The first search for a tie date: every yard at once, unless the catalog
   * already shows a full search page of the date, which would cap it. */
  plan: (tie: PickapartvaTie, startedAt: number): PickapartvaRecovery => ({
    ...tie,
    startedAt,
    searches: [],
    hidden: [],
    pending:
      tie.shown.length < PICKAPARTVA_PAGE_SIZE
        ? [{ id: "ANY", make: "ANY" }]
        : yards(),
  }),

  resolved: (recovery: PickapartvaRecovery) => recovery.pending.length === 0,

  /** Whether this recovery answers for `tie` as the current catalog shows
   * it: the same date, repeated slots and shown donors. */
  matches: (recovery: PickapartvaRecovery, tie: PickapartvaTie) =>
    recovery.date === tie.date &&
    recovery.slots === tie.slots &&
    JSON.stringify(recovery.shown) === JSON.stringify(tie.shown),

  fresh: (recovery: PickapartvaRecovery, now: number) =>
    now >= recovery.startedAt &&
    now - recovery.startedAt <= PICKAPARTVA_RECOVERY_LIFETIME_MS,

  /**
   * Records the next pending search's result. Throws when the searches list
   * more unseen donors than the catalog hid, or run out short of them (the
   * inventory changed, so a later crawl can pass), and when a make search is
   * capped (no narrower native split is verified).
   */
  record: (
    recovery: PickapartvaRecovery,
    url: string,
    result: PickapartvaSearchResult,
  ): PickapartvaRecovery => {
    const [step, ...rest] = recovery.pending;
    const { page } = result;
    if (
      step === undefined ||
      page.date !== recovery.date ||
      page.id !== step.id ||
      page.make !== step.make ||
      url !== pickapartvaSearchHref(recovery.date, step.id, step.make)
    )
      throw new Error(
        `Pick-A-Part VA search ${url} is not the next pending search for ${recovery.date}`,
      );
    const known = new Set([
      ...recovery.shown,
      ...recovery.hidden.map((donor) => pickapartvaCardKey(donor.record)),
    ]);
    const found: PickapartvaHiddenDonor[] = [];
    for (const record of page.records) {
      const key = pickapartvaCardKey(record);
      if (known.has(key)) continue;
      known.add(key);
      found.push({ id: step.id, make: step.make, record });
    }
    const hidden = [...recovery.hidden, ...found];
    if (hidden.length > recovery.slots)
      throw transientRejection(new Error(short(recovery, hidden.length)));
    const capped = result.status === "capped";
    let pending = rest;
    if (hidden.length === recovery.slots) pending = [];
    else if (result.status === "capped") {
      if (step.make !== "ANY")
        throw new Error(
          `Pick-A-Part VA ${step.make} search for ${recovery.date} in ${step.id} returned ${PICKAPARTVA_PAGE_SIZE} cards; completeness is only known for 0 to ${PICKAPARTVA_PAGE_SIZE - 1} matched donor cards per make, and no narrower native split is verified`,
        );
      pending =
        step.id === "ANY"
          ? [...rest, ...yards()]
          : [
              ...rest,
              ...splitMakes(
                recovery.date,
                step.id,
                result.makes,
                page.records,
              ).map((make) => ({ id: step.id, make })),
            ];
    }
    if (!pending.length && hidden.length < recovery.slots)
      throw transientRejection(new Error(short(recovery, hidden.length)));
    return {
      ...recovery,
      searches: [
        ...recovery.searches,
        { id: step.id, make: step.make, url, hash: page.hash, capped },
      ],
      hidden,
      pending,
    };
  },
} as const;
