import { z } from "zod";

/**
 * Census for native make/model directories (URG parts plugins) and other
 * keyed page sets.
 *
 * Every connector names what an unchanged key proves (`reuse`):
 * - `never`: the key and published count name a page whose cards can change
 *   while both stay the same (one donor crushed and another placed under the
 *   same model badge). This is every model page under a menu badge, the only
 *   complete VIN-bearing listing those sites publish, so every run reads every
 *   page. The census still supplies read reasons, expected cards, closing
 *   floors and coverage references.
 * - `unchanged-key`: the key binds the whole entry of a complete listing read
 *   this run (603's catalog card), so a carried page belongs to an entry the
 *   site still lists unchanged. A run then reads a page only when it is new,
 *   its count changed, the connector names it as triggered, it is short, its
 *   evidence reached the age ceiling, or it falls in today's sweep slice.
 *   Every other page carries its last accepted evidence unchanged.
 *
 * Carrying needs an accepted census from today or the previous run day.
 * After a missed, failed or rejected run (a gap of more than one day),
 * every page is read again (reason `gap`), so a fault that caused a
 * rejection is re-read in full and cannot hide behind carried pages. Only a
 * normal incremental run confirms short pages: a cold, gap or outage run
 * stores none as confirmed, so the next run reads them again.
 *
 * A model's expected card count is its published count plus a sticky surplus of
 * placeholder or surplus rows its pages have listed. The surplus grows with
 * any read that lists more and carries across count changes. A read listing
 * less keeps it (`lowSince` and `lowCount` record when and at what count), and
 * a normal incremental run lowers it after six run days of such reads, unless
 * the count rose at some point in the window by at least the missing cards
 * (arrival lag; `lowRise`), and after twelve run days in any case. A surplus
 * lowered by time while the page still lists less stays as a `ceiling` for
 * twelve run days, until a read lists it again: closing re-reads any read
 * below it, or, without a closing pass, the next run reads it again
 * (`recheck`). A
 * surplus first seen or grown on a cold, gap or outage read is unconfirmed and
 * read again by the next incremental run. A page with fewer cards than its published
 * count is carried only when a normal incremental run read it and confirmed
 * it with an identical re-read. Any other page below its expected count (an unconfirmed
 * short page, or a surplus page that lost cards without its count dropping)
 * is read again on the next run, so a transient short read is never carried.
 * `closingReads` names the pages a connector's closing must re-read for that
 * confirmation.
 *
 * `coverage` separately bounds the whole union of read and carried cards, both
 * against today's published counts (a per-source floor that also holds on cold
 * runs) and against the last accepted card counts, lowered by any drop in a
 * model's published count (a fixed replay floor, independent of badge
 * accuracy). A full read after a gap of two to five days is judged against
 * every reference, so a rejection holds on every later run. When the last
 * accepted run is six or more days old (an outage, or a real drop that stayed
 * rejected that long), the run is judged like a cold run, on the badge floor,
 * so no yard stays blocked. Pages that break a sixth at a time, emptied or cut
 * to one card each, fail the run on the first broken day.
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
  /** Cards the page is expected to list: its count plus a sticky surplus of
   * placeholder or surplus rows (see `expected`). */
  expected: number;
  /** First run day since which reads have listed fewer cards than `expected`
   * allows above the count, or null. The surplus is lowered only after six
   * run days of such reads. */
  lowSince: number | null;
  /** Count when the surplus was last seen intact, set when the low window
   * opens (null when there is none). A count risen since then by at least the
   * missing cards looks like arrival lag and keeps the window from lowering
   * the surplus before the twelve-day bound. */
  lowCount: number | null;
  /** Largest rise of the count above `lowCount` seen while the window is open
   * (null when there is none). A later sale cannot cancel an arrival's lag. */
  lowRise: number | null;
  /** Surplus that a time rule lowered while the page still listed less, kept
   * as a floor for re-reads (null when there is none). On connectors with a
   * closing pass, any read listing fewer than count plus ceiling is
   * closing-read, so a one-off fault behind a real placeholder fails the run;
   * on connectors without one, such a read is read again on the next run
   * (`recheck`). Cleared once a read lists the ceiling again, and dropped
   * twelve run days after it was set, so its extra reads are bounded. */
  ceiling: number | null;
  /** Run day the ceiling was set (null when there is none). */
  ceilingSince: number | null;
  /** Set on a connector without a closing pass when a read listed fewer than
   * count plus the ceiling closing would enforce: the next run reads the page
   * again (reason `short`), standing in for a closing re-read. Cleared when
   * that re-read lists the same cards; set again when it lists other cards.
   * The read on the day the ceiling expires can still set it, so it may
   * outlive the ceiling by one run. */
  recheck: boolean;
  /** True when a normal incremental run observed this surplus (or there is
   * none). A surplus first seen, or grown, on a cold, gap or outage full read
   * is unconfirmed, and the next incremental run reads the page again: a fault
   * on that one day could have hidden real cards behind the placeholders. */
  surplusConfirmed: boolean;
  /** True only for a page with fewer cards than `count` that an identical
   * re-read confirmed in the run that read it. */
  confirmed: boolean;
  page: Page;
}

/** How a run treated short pages it read: confirmed by an identical in-run
 * re-read (otherwise the run failed), or not confirmed at all. Without that
 * re-read, a page below its ceiling is read again on the next run, which
 * settles it only when `identity` (the cards a page lists, not its count) is
 * unchanged. */
export type ModelCensusShortPages<Page> =
  | "confirmed"
  | { kind: "unconfirmed"; identity: (page: Page) => string };

/** What an unchanged key and count prove about a page (see the module
 * comment): nothing (`never`, read every page every run), or that a complete
 * listing read this run still shows the same entry (`unchanged-key`). */
export type ModelCensusReuse = "never" | "unchanged-key";

export interface ModelCensusPlanOptions<Page> {
  /** Cards a page lists, compared with its published count. */
  cards: (page: Page) => number;
  /** Keys a connector-specific signal (for example an arrival) forces to read. */
  triggers?: ReadonlySet<string>;
  reuse: ModelCensusReuse;
}

export interface ModelCensus<Page> {
  /** Connector scope plus census contract; any change forces a cold census. */
  contract: string;
  day: number;
  models: ModelCensusEvidence<Page>[];
}

export type ModelCensusReadReason =
  | "cold"
  | "gap"
  | "new"
  | "count"
  | "trigger"
  | "short"
  | "stale"
  | "sweep"
  /** Read only because the connector never reuses pages (`reuse: never`). */
  | "daily";

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
              lowSince: day.nullable(),
              lowCount: z.number().int().nonnegative().safe().nullable(),
              lowRise: z.number().int().nonnegative().safe().nullable(),
              ceiling: z.number().int().positive().safe().nullable(),
              ceilingSince: day.nullable(),
              recheck: z.boolean(),
              surplusConfirmed: z.boolean(),
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
      if (
        census.models.some(
          (m) =>
            m.expected < m.count ||
            (m.lowSince !== null &&
              (m.lowSince > m.readDay || m.expected === m.count)) ||
            (m.lowSince === null) !== (m.lowCount === null) ||
            (m.lowSince === null) !== (m.lowRise === null) ||
            (m.ceiling !== null && m.ceiling <= m.expected - m.count) ||
            (m.ceiling === null) !== (m.ceilingSince === null) ||
            (m.expected === m.count && !m.surplusConfirmed),
        )
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Model census expects fewer cards than a published count or holds an inconsistent surplus window",
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

/** Sticky surplus of a model's last accepted evidence: the placeholder or
 * surplus rows it is expected to list above its count. */
const surplusOf = (evidence: { expected: number; count: number }) =>
  evidence.expected - evidence.count;

/** Expected cards per published model: today's count plus the sticky surplus
 * of its last accepted evidence. The surplus grows with any read that lists
 * more, carries across count changes, and is lowered only after six run days
 * of reads listing less (see `accept`), so one lagging read cannot erase it. */
function expected<Page>(
  controls: readonly ModelCensusControl[],
  previous: ModelCensus<Page> | null,
): number[] {
  const evidence = new Map((previous?.models ?? []).map((m) => [m.key, m]));
  return controls.map((control) => {
    const before = evidence.get(control.key);
    return control.count + (before ? surplusOf(before) : 0);
  });
}

/** Cards a read of each published model must list for closing to treat it as
 * complete rather than short: today's count plus the larger of its sticky
 * surplus and any ceiling. A read at or above its floor is closing-read only
 * because it lists more than its count. */
function closingFloors<Page>(
  controls: readonly ModelCensusControl[],
  previous: ModelCensus<Page> | null,
): number[] {
  const evidence = new Map((previous?.models ?? []).map((m) => [m.key, m]));
  return controls.map((control) => {
    const before = evidence.get(control.key);
    return (
      control.count +
      Math.max(before ? surplusOf(before) : 0, before?.ceiling ?? 0)
    );
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
  { cards, triggers = new Set(), reuse }: ModelCensusPlanOptions<Page>,
): ModelCensusDecision<Page>[] {
  if (!previous || previous.day > today)
    return controls.map(() => ({ kind: "read", reason: "cold" }));
  // Incremental reading needs an accepted census from today or the previous
  // run day. After a missed, failed or rejected run, every page is read again
  // so a fault that caused a rejection cannot hide behind carried pages.
  if (today - previous.day > 1)
    return controls.map(() => ({ kind: "read", reason: "gap" }));
  const evidence = new Map(previous.models.map((m) => [m.key, m]));
  return controls.map((control): ModelCensusDecision<Page> => {
    const before = evidence.get(control.key);
    if (!before) return { kind: "read", reason: "new" };
    if (before.count !== control.count)
      return { kind: "read", reason: "count" };
    if (triggers.has(control.key)) return { kind: "read", reason: "trigger" };
    if (
      (cards(before.page) < before.expected && !before.confirmed) ||
      !before.surplusConfirmed ||
      before.recheck
    )
      return { kind: "read", reason: "short" };
    if (reuse === "never") return { kind: "read", reason: "daily" };
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

  closingFloors,

  /** Indices of pages read this run that closing must re-read and compare:
   * every read page whose cards differ from its published count or fall below
   * its closing floor. Carried pages were confirmed by the run that read them. */
  closingReads<Page>({
    controls,
    pages,
    decisions,
    previous,
    cards,
  }: ModelCensusRun<Page>): number[] {
    const floors = closingFloors(controls, previous);
    return controls.flatMap((control, index) => {
      const page = pages[index];
      const listed = page === undefined ? null : cards(page);
      return decisions[index]?.kind === "read" &&
        listed !== null &&
        (listed !== control.count || listed < (floors[index] ?? control.count))
        ? [index]
        : [];
    });
  },

  /** Terminal census for the next run: fresh reads are dated today, carried
   * evidence keeps its original read day, expectation and confirmation. A page
   * read today below its published count counts as confirmed only when this
   * is a normal incremental run (an accepted census from today or the previous
   * run day) and the connector's closing re-read it identically
   * (`shortPages: "confirmed"`). A
   * page that only fell below a higher previous card count is never confirmed:
   * a real change and a transient drop look alike, so the next run re-reads it. */
  accept<Page>(
    contract: string,
    today: number,
    run: ModelCensusRun<Page>,
    shortPages: ModelCensusShortPages<Page>,
  ): ModelCensus<Page> {
    const { controls, pages, decisions, previous, cards } = run;
    if (
      pages.length !== controls.length ||
      decisions.length !== controls.length
    )
      throw new Error(
        `Model census cannot close: ${pages.length} pages and ${decisions.length} decisions for ${controls.length} published models`,
      );
    const evidence = new Map((previous?.models ?? []).map((m) => [m.key, m]));
    // Only a normal incremental run (an accepted census from today or the
    // previous run day) confirms short pages. Cold, gap and outage runs read
    // every page, so a fault confined to that one day would otherwise pass
    // both floors, be stored as confirmed and be carried for days, past the
    // 72-hour delete window. Their short pages are read again the next run.
    const incremental = previous !== null && today - previous.day <= 1;
    const confirming = shortPages === "confirmed" && incremental;
    return {
      contract,
      day: today,
      models: controls.map((control, index) => {
        const decision = decisions[index];
        const page = pages[index];
        if (!decision || page === undefined)
          throw new Error("Model census evidence is missing a published model");
        if (decision.kind === "carry") {
          const carried = decision.evidence;
          const expired =
            carried.ceilingSince !== null &&
            today - carried.ceilingSince >= 2 * MODEL_CENSUS_SWEEP_DAYS;
          return {
            ...carried,
            key: control.key,
            count: control.count,
            ...(expired ? { ceiling: null, ceilingSince: null } : {}),
          };
        }
        // The surplus follows a read that lists at least as much. A read that
        // lists less keeps it (badge lag after a sale looks exactly like a
        // lost card) and opens a low window; meanwhile the page counts as
        // short and is read again every run. A normal incremental run lowers
        // it once the window has lasted six run days, unless the count has
        // risen at some point in the window, above the count when the surplus
        // was last intact, by at least the missing cards (arrival lag: badges
        // counting arrivals before their cards appear; a later sale does not
        // cancel it). Count changes never restart the window, and after twelve
        // run days it is lowered whatever the count did, so a busy model's
        // removed placeholder costs bounded reads. A surplus lowered by time
        // while the page still lists less stays as a ceiling for twelve run
        // days: closing, or the next run without a closing pass, re-reads any
        // read below it. Cold, gap and outage full reads never lower it.
        const before = evidence.get(control.key);
        const held = before ? surplusOf(before) : 0;
        const observed = Math.max(0, cards(page) - control.count);
        const open =
          before?.lowSince !== null && before?.lowSince !== undefined;
        const lowSince = open ? (before?.lowSince ?? today) : today;
        const lowCount = open
          ? (before?.lowCount ?? control.count)
          : (before?.count ?? control.count);
        const age = today - lowSince;
        const lowRise = Math.max(
          open ? (before?.lowRise ?? 0) : 0,
          control.count - lowCount,
        );
        const lagging = lowRise > 0 && held - observed <= lowRise;
        const lowered =
          observed >= held ||
          (incremental &&
            (age >= 2 * MODEL_CENSUS_SWEEP_DAYS ||
              (age >= MODEL_CENSUS_SWEEP_DAYS && !lagging)));
        const surplus = lowered ? observed : held;
        // A time rule lowered a surplus the page still lists less than: keep
        // the old surplus as a ceiling until a read lists it again (kept above
        // the surplus, which is at least what this read lists), and drop it
        // twelve run days after it was set so its extra reads stay bounded.
        const raised =
          lowered && observed < held && held > (before?.ceiling ?? 0);
        const kept = raised ? held : (before?.ceiling ?? null);
        const keptSince = raised ? today : (before?.ceilingSince ?? today);
        const ceiling =
          kept !== null &&
          kept > surplus &&
          today - keptSince < 2 * MODEL_CENSUS_SWEEP_DAYS
            ? kept
            : null;
        // Without a closing pass, a read below the ceiling (including the
        // read that sets it) is read again on the next run instead. It
        // enforces the ceiling closingReads would (the previous evidence's,
        // or the one this read raises), so both modes stop on the same run
        // day. That re-read settles it only when it lists the same cards;
        // other cards (for example a fault on either read, even at the same
        // count) ask for another.
        const enforced = raised ? held : (before?.ceiling ?? null);
        const recheck =
          shortPages !== "confirmed" &&
          enforced !== null &&
          cards(page) < control.count + enforced &&
          !(
            before?.recheck === true &&
            shortPages.identity(page) === shortPages.identity(before.page)
          );
        // Only a normal incremental run confirms a surplus it observes; a full
        // read keeps an earlier confirmation only when it saw the same surplus.
        const surplusConfirmed =
          surplus === 0 ||
          (lowered
            ? incremental ||
              (observed === held && before?.surplusConfirmed === true)
            : before?.surplusConfirmed === true);
        return {
          key: control.key,
          count: control.count,
          readDay: today,
          expected: control.count + surplus,
          lowSince: lowered ? null : lowSince,
          lowCount: lowered ? null : lowCount,
          lowRise: lowered ? null : lowRise,
          ceiling,
          ceilingSince: ceiling === null ? null : keptSince,
          recheck,
          surplusConfirmed,
          confirmed: confirming && cards(page) < control.count,
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
   *   last accepted run is under six days old. A model whose count moved keeps
   *   a reference lowered by any drop in its count (an increase demands
   *   nothing, since pages can lag new arrivals). Once it is six or more days old
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
          // Cards may fall only as far as the published count fell; an
          // increase demands nothing, since pages can lag new arrivals.
          return before && replaying
            ? Math.max(
                0,
                cards(before.page) + Math.min(0, control.count - before.count),
              )
            : null;
        }),
        MODEL_CENSUS_REPLAY_MINIMUM,
        "that the last accepted census listed, less any drop in their counts",
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
