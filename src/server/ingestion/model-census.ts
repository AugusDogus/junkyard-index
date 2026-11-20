import { z } from "zod";

/**
 * Incremental census for native make/model directories (URG parts plugins).
 *
 * The model page is the only complete VIN-bearing listing, so a run still reads
 * every make menu, then reads a model page only when it is new, its published
 * count changed, the connector names it as triggered (for example by an unseen
 * arrival), its evidence reached the age ceiling, or it falls in today's sweep
 * slice. Every other model carries its last accepted page forward unchanged.
 *
 * A model's expected card count is its published count plus any surplus its
 * previous accepted page listed above that page's own count (some pages list
 * placeholders or surplus rows). A page with fewer
 * cards than its published count is carried only when the run that read it
 * confirmed it with an identical re-read. Any other page below its expected
 * count (an unconfirmed short page, or a surplus page that lost cards without
 * its count dropping) is read again on the next run, so a transient short read
 * is never carried. `closingReads` names the pages a connector's closing must
 * re-read for that confirmation.
 *
 * `coverage` separately bounds the whole union of read and carried cards, both
 * against today's published counts (a per-source floor that also holds on cold
 * runs) and against the last accepted card counts of models whose published
 * count is unchanged (a fixed replay floor, independent of badge accuracy).
 * Every reference counts while the last accepted run is under six days old, so
 * a rejection holds on later runs and a missed run cannot age a broken slice
 * out of the check. When the last accepted run is six or more days old (an
 * outage, or a real drop that stayed rejected that long), the run reads every
 * page again and is judged like a cold run instead of failing against a
 * frozen census every day.
 * Pages that break a sixth at a time, emptied or cut to one card each, fail the
 * run on the first broken day.
 *
 * Run days are UTC day numbers fixed at run start. The sweep slice equals the
 * age ceiling, so a model read on day d is due again on day d + 6 by both rules,
 * and missed runs can only make the age rule fire earlier. A model's slice comes
 * from its key, not its list position, so a model appearing or disappearing
 * never moves the others to another day.
 */
export const MODEL_CENSUS_DAY_MS = 24 * 60 * 60 * 1000;
export const MODEL_CENSUS_SWEEP_DAYS = 6;
/** Share of last accepted cards that models with an unchanged published count
 * must still list. Healthy incremental runs sit near 100%; one sweep slice cut
 * to a single card per page falls below it in every observed capture. */
export const MODEL_CENSUS_REPLAY_MINIMUM = 0.97;

/** One published model control. `key` must change whenever any field the page
 * parser binds to (paths, labels, parent make) changes, so carried evidence is
 * never reused under a different context. */
export interface ModelCensusControl {
  key: string;
  count: number;
}

export interface ModelCensusEvidence<Page> {
  key: string;
  /** Published count when the page was read. */
  count: number;
  readDay: number;
  /** Cards the page was expected to list when read (see `expected`). */
  expected: number;
  /** True only for a page with fewer cards than `count` that an identical
   * re-read confirmed in the run that read it. */
  confirmed: boolean;
  page: Page;
}

/** How a run treated short pages it read: confirmed by an identical in-run
 * re-read (otherwise the run failed), or not confirmed at all. */
export type ModelCensusShortPages = "confirmed" | "unconfirmed";

export interface ModelCensusPlanOptions<Page> {
  /** Cards a page lists, compared with its published count. */
  cards: (page: Page) => number;
  /** Keys a connector-specific signal (for example an arrival) forces to read. */
  triggers?: ReadonlySet<string>;
}

export interface ModelCensus<Page> {
  /** Connector scope plus census contract; any change forces a cold census. */
  contract: string;
  day: number;
  models: ModelCensusEvidence<Page>[];
}

export type ModelCensusReadReason =
  | "cold"
  | "new"
  | "count"
  | "trigger"
  | "short"
  | "stale"
  | "sweep";

export type ModelCensusDecision<Page> =
  | { kind: "read"; reason: ModelCensusReadReason }
  | { kind: "carry"; evidence: ModelCensusEvidence<Page> };

export type ModelCensusPrevious<Page> =
  | { kind: "cold"; warning: string | null }
  | { kind: "incremental"; census: ModelCensus<Page> };

const day = z.number().int().nonnegative().safe();

/** Stable sweep slice for a model key: 32-bit FNV-1a, then the murmur3
 * finalizer. FNV-1a alone keeps the parity of the key's characters, and keys
 * that repeat a label (in its path and as the label) would then pin every model
 * of a make to odd or even days. */
function slice(key: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % MODEL_CENSUS_SWEEP_DAYS;
}

function schema<Page>(page: z.ZodType<Page>, maxModels: number) {
  return z
    .object({
      contract: z.string().min(1).max(256),
      day,
      models: z
        .array(
          z
            .object({
              key: z.string().min(1).max(2000),
              count: z.number().int().nonnegative().safe(),
              readDay: day,
              expected: z.number().int().nonnegative().safe(),
              confirmed: z.boolean(),
              page,
            })
            .strict(),
        )
        .max(maxModels),
    })
    .strict()
    .superRefine((census, context) => {
      if (
        new Set(census.models.map((m) => m.key)).size !== census.models.length
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Model census repeats a published model",
        });
      if (census.models.some((m) => m.expected < m.count))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Model census expects fewer cards than a published count",
        });
      if (
        census.models.some(
          (m) =>
            m.readDay > census.day ||
            census.day - m.readDay >= MODEL_CENSUS_SWEEP_DAYS,
        )
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Model census holds future evidence or evidence past the six-day ceiling",
        });
    });
}

/** Expected cards per published model: today's count plus any surplus the
 * previous accepted page listed above its own count (placeholder or surplus
 * rows). The surplus carries across a count change, so a placeholder page that
 * loses a donor on the same day its count moves is still caught. */
function expected<Page>(
  controls: readonly ModelCensusControl[],
  previous: ModelCensus<Page> | null,
  cards: (page: Page) => number,
): number[] {
  const evidence = new Map((previous?.models ?? []).map((m) => [m.key, m]));
  return controls.map((control) => {
    const before = evidence.get(control.key);
    return before
      ? control.count + Math.max(0, cards(before.page) - before.count)
      : control.count;
  });
}

/** Inputs shared by the closing, acceptance and coverage steps of one run. */
export interface ModelCensusRun<Page> {
  controls: readonly ModelCensusControl[];
  pages: readonly Page[];
  decisions: readonly ModelCensusDecision<Page>[];
  /** The compatible census this run planned from, or null on a cold run. */
  previous: ModelCensus<Page> | null;
  cards: (page: Page) => number;
}

function plan<Page>(
  controls: readonly ModelCensusControl[],
  previous: ModelCensus<Page> | null,
  today: number,
  { cards, triggers = new Set() }: ModelCensusPlanOptions<Page>,
): ModelCensusDecision<Page>[] {
  if (!previous || previous.day > today)
    return controls.map(() => ({ kind: "read", reason: "cold" }));
  const evidence = new Map(previous.models.map((m) => [m.key, m]));
  return controls.map((control): ModelCensusDecision<Page> => {
    const before = evidence.get(control.key);
    if (!before) return { kind: "read", reason: "new" };
    if (before.count !== control.count)
      return { kind: "read", reason: "count" };
    if (triggers.has(control.key)) return { kind: "read", reason: "trigger" };
    if (cards(before.page) < before.expected && !before.confirmed)
      return { kind: "read", reason: "short" };
    if (today - before.readDay >= MODEL_CENSUS_SWEEP_DAYS)
      return { kind: "read", reason: "stale" };
    if (
      slice(control.key) === today % MODEL_CENSUS_SWEEP_DAYS &&
      before.readDay < today
    )
      return { kind: "read", reason: "sweep" };
    return { kind: "carry", evidence: before };
  });
}

export const ModelCensus = {
  /** UTC run day for a run-start timestamp. */
  day: (now: number) => Math.floor(now / MODEL_CENSUS_DAY_MS),

  schema,

  slice,

  /**
   * Accepts a published terminal census only when its contract matches and it is
   * not dated after this run. Anything else is a cold census with a warning; a
   * missing census (first run or pre-incremental cursor) is a silent cold start.
   */
  previous<Page>(
    census: ModelCensus<Page> | null | undefined,
    contract: string,
    today: number,
  ): ModelCensusPrevious<Page> {
    if (!census) return { kind: "cold", warning: null };
    if (census.contract !== contract)
      return {
        kind: "cold",
        warning:
          "Previous model census used another parser or traversal contract; reading every model page.",
      };
    if (census.day > today)
      return {
        kind: "cold",
        warning:
          "Previous model census is dated after this run; reading every model page.",
      };
    return { kind: "incremental", census };
  },

  plan,

  /** Index of the first model at or after `from` that needs a native read, or
   * `decisions.length` when every remaining model carries. */
  nextRead<Page>(
    decisions: readonly ModelCensusDecision<Page>[],
    from: number,
  ): number {
    for (let index = from; index < decisions.length; index++)
      if (decisions[index]?.kind === "read") return index;
    return decisions.length;
  },

  /** Carried pages from `from` up to (not including) the next read. */
  carriedRun<Page>(
    decisions: readonly ModelCensusDecision<Page>[],
    from: number,
  ): Page[] {
    const pages: Page[] = [];
    for (let index = from; index < decisions.length; index++) {
      const decision = decisions[index];
      if (!decision || decision.kind === "read") break;
      pages.push(decision.evidence.page);
    }
    return pages;
  },

  expected,

  /** Indices of pages read this run that closing must re-read and compare:
   * every read page whose cards differ from its published count or fall below
   * its expected count. Carried pages were confirmed by the run that read them. */
  closingReads<Page>({
    controls,
    pages,
    decisions,
    previous,
    cards,
  }: ModelCensusRun<Page>): number[] {
    const wanted = expected(controls, previous, cards);
    return controls.flatMap((control, index) => {
      const page = pages[index];
      const listed = page === undefined ? null : cards(page);
      return decisions[index]?.kind === "read" &&
        listed !== null &&
        (listed !== control.count || listed < (wanted[index] ?? control.count))
        ? [index]
        : [];
    });
  },

  /** Terminal census for the next run: fresh reads are dated today, carried
   * evidence keeps its original read day, expectation and confirmation. A page
   * read today below its published count counts as confirmed only when the
   * connector's closing re-read it identically (`shortPages: "confirmed"`). A
   * page that only fell below a higher previous card count is never confirmed:
   * a real change and a transient drop look alike, so the next run re-reads it. */
  accept<Page>(
    contract: string,
    today: number,
    run: ModelCensusRun<Page>,
    shortPages: ModelCensusShortPages,
  ): ModelCensus<Page> {
    const { controls, pages, decisions, previous, cards } = run;
    if (
      pages.length !== controls.length ||
      decisions.length !== controls.length
    )
      throw new Error(
        `Model census cannot close: ${pages.length} pages and ${decisions.length} decisions for ${controls.length} published models`,
      );
    const wanted = expected(controls, previous, cards);
    return {
      contract,
      day: today,
      models: controls.map((control, index) => {
        const decision = decisions[index];
        const page = pages[index];
        if (!decision || page === undefined)
          throw new Error("Model census evidence is missing a published model");
        return decision.kind === "carry"
          ? { ...decision.evidence, key: control.key, count: control.count }
          : {
              key: control.key,
              count: control.count,
              readDay: today,
              expected: wanted[index] ?? control.count,
              confirmed:
                shortPages === "confirmed" && cards(page) < control.count,
              page,
            };
      }),
    };
  },

  /**
   * Reconciles the union of read and carried cards before anything is
   * published. Each model contributes at most its reference count, so surplus
   * cards on one model cannot hide a shortfall on another. Two floors apply:
   * - against today's published counts, at the connector's `minimum`, which
   *   must allow for that source's healthy badge accuracy and holds on cold runs;
   * - against the last accepted card counts of models whose published count is
   *   unchanged, at MODEL_CENSUS_REPLAY_MINIMUM for every source, while the
   *   last accepted run is under six days old. Once it is six or more days old
   *   (an outage, or a real drop rejected that long) this check steps aside
   *   and the run is judged like a cold run.
   * Carried pages keep floors and drift guards satisfied while pages break a
   * sixth at a time; these checks fail the first such run. Returns null or an
   * error message naming the largest shortfalls.
   */
  coverage<Page>(
    source: string,
    // `day` is null only before a census begins; it then has no references.
    run: Omit<ModelCensusRun<Page>, "decisions"> & { day: number | null },
    minimum: number,
    label: (index: number) => string,
  ): string | null {
    const { controls, pages, previous, cards, day: today } = run;
    // Every reference stays in while the last accepted run is under six days
    // old: routine sweep reads happen at age six, and after a rejected or
    // missed run the broken slice ages past six while `previous` stays put.
    // Dropping old references there would let a broken page through the day
    // after its rejection. Only when the last accepted run is itself six or
    // more days old (an outage, or a real drop rejected that long) is the run
    // judged like a cold run, on the badge floor alone.
    const replaying =
      today !== null &&
      previous !== null &&
      today - previous.day < MODEL_CENSUS_SWEEP_DAYS;
    const evidence = new Map((previous?.models ?? []).map((m) => [m.key, m]));
    const listed = controls.map((_, index) => {
      const page = pages[index];
      return page === undefined ? 0 : cards(page);
    });
    const check = (
      references: readonly (number | null)[],
      floor: number,
      basis: string,
    ) => {
      let covered = 0;
      let total = 0;
      const shortfalls: { index: number; missing: number }[] = [];
      references.forEach((reference, index) => {
        if (reference === null) return;
        const cardsListed = listed[index] ?? 0;
        covered += Math.min(cardsListed, reference);
        total += reference;
        if (cardsListed < reference)
          shortfalls.push({ index, missing: reference - cardsListed });
      });
      if (covered >= Math.ceil(total * floor)) return null;
      const largest = shortfalls
        .sort((a, b) => b.missing - a.missing)
        .slice(0, 5)
        .map(({ index, missing }) => `${label(index)} (${missing})`);
      return `${source} model pages list ${covered} of ${total} cards ${basis}, below the ${Math.round(floor * 1000) / 10}% coverage floor. Nothing was published and the last accepted census stays in place. Largest shortfalls: ${largest.join(", ")}. Check whether those native model pages still render their cards before retrying.`;
    };
    return (
      check(
        controls.map((control) => control.count),
        minimum,
        "promised by today's model counts",
      ) ??
      check(
        controls.map((control) => {
          const before = evidence.get(control.key);
          return before && replaying && before.count === control.count
            ? cards(before.page)
            : null;
        }),
        MODEL_CENSUS_REPLAY_MINIMUM,
        "that the last accepted census listed for models whose counts did not change",
      )
    );
  },

  /** Plain summary for run warnings. */
  summary<Page>(decisions: readonly ModelCensusDecision<Page>[]): string {
    const reads = new Map<ModelCensusReadReason, number>();
    let carried = 0;
    for (const decision of decisions)
      if (decision.kind === "carry") carried++;
      else reads.set(decision.reason, (reads.get(decision.reason) ?? 0) + 1);
    const read = decisions.length - carried;
    const reasons = [...reads].map(([reason, n]) => `${reason} ${n}`);
    return `Read ${read} of ${decisions.length} model pages${reasons.length ? ` (${reasons.join(", ")})` : ""}; carried ${carried}.`;
  },
} as const;
