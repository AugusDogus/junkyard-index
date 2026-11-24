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

/** At most this many censuses in one attempt may plan searches again because
 * the catalog no longer showed a tie date as its recovery saw it. */
export const PICKAPARTVA_MAX_REPLANS = 2;

/** Why a census planned a tie date's searches again instead of reusing its
 * saved recovery. */
export type PickapartvaReplanReason = "new" | "changed" | "stale";
export interface PickapartvaReplan {
  date: string;
  reason: PickapartvaReplanReason;
}
const replanReasons: Record<PickapartvaReplanReason, string> = {
  new: "newly repeated",
  changed: "shown donors or repeated slots changed",
  stale: `searches older than ${PICKAPARTVA_RECOVERY_LIFETIME_MS / 60_000} minutes`,
};

const unproven = (recovery: PickapartvaRecovery, found: number) =>
  `Pick-A-Part VA set-date searches for ${recovery.date} add ${found} donors, but the catalog repeated ${recovery.slots} cards of that date, so completeness is unproven`;

/** Searches that ran out short. After a make split the missing donor may be
 * of a make the native selector does not offer (Tesla), which no search
 * reaches, so the message names both causes and the makes searched. */
function shortfall(
  recovery: PickapartvaRecovery,
  found: number,
  searched: readonly PickapartvaSearchStep[],
) {
  const splits = PICKAPARTVA_YARD_CODES.flatMap((id) => {
    const makes = searched
      .filter((step) => step.id === id && step.make !== "ANY")
      .map((step) => step.make);
    return makes.length ? [`${id}: ${makes.join(", ")}`] : [];
  });
  return splits.length
    ? `${unproven(recovery, found)}. Either the inventory changed between reads, or a hidden donor's make is missing from the native make selector (${splits.join("; ")}). The source retries from a fresh catalog read within its daily attempts; if every attempt fails this way, compare the yard's donors on its set-date search with these makes`
    : `${unproven(recovery, found)}. The inventory changed between reads; the source retries from a fresh catalog read within its daily attempts`;
}

export const PickapartvaRecovery = {
  /** The first search for a tie date: every yard at once, unless the date's
   * shown and hidden donors fill a search page, which would cap it. */
  plan: (tie: PickapartvaTie, startedAt: number): PickapartvaRecovery => ({
    ...tie,
    startedAt,
    searches: [],
    hidden: [],
    pending:
      tie.shown.length + tie.slots < PICKAPARTVA_PAGE_SIZE
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
   * The recoveries a census at `now` uses for its `ties`: each saved recovery
   * that still matches its tie and is fresh, with its progress, and a new
   * plan for every other tie, with why it was planned again.
   */
  reconcile: (
    stored: readonly PickapartvaRecovery[],
    ties: readonly PickapartvaTie[],
    now: number,
  ): { recoveries: PickapartvaRecovery[]; replans: PickapartvaReplan[] } => {
    const replans: PickapartvaReplan[] = [];
    const recoveries = ties.map((tie) => {
      const saved = stored.find((recovery) => recovery.date === tie.date);
      if (
        saved &&
        PickapartvaRecovery.matches(saved, tie) &&
        PickapartvaRecovery.fresh(saved, now)
      )
        return saved;
      replans.push({
        date: tie.date,
        reason:
          saved === undefined
            ? "new"
            : PickapartvaRecovery.matches(saved, tie)
              ? "stale"
              : "changed",
      });
      return PickapartvaRecovery.plan(tie, now);
    });
    return { recoveries, replans };
  },

  describeReplans: (replans: readonly PickapartvaReplan[]) =>
    replans
      .map((replan) => `${replan.date} (${replanReasons[replan.reason]})`)
      .join(", "),

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
    const onPage = new Set<string>();
    for (const record of page.records) {
      const key = pickapartvaCardKey(record);
      // One search is one native query, so it can list a donor only once.
      if (onPage.has(key))
        throw new Error(
          `Pick-A-Part VA search ${url} lists one donor card twice (stock ${record.stock}, Set Date ${record.setDate}), so the donors it hid cannot be counted. Nothing from this attempt was published; check whether the search page format changed`,
        );
      onPage.add(key);
      if (known.has(key)) continue;
      known.add(key);
      found.push({ id: step.id, make: step.make, record });
    }
    const hidden = [...recovery.hidden, ...found];
    if (hidden.length > recovery.slots)
      throw transientRejection(
        new Error(
          `${unproven(recovery, hidden.length)}. The inventory changed between reads; the source retries from a fresh catalog read within its daily attempts`,
        ),
      );
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
      throw transientRejection(
        new Error(
          shortfall(recovery, hidden.length, [...recovery.searches, step]),
        ),
      );
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
