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
 * Run days are UTC day numbers fixed at run start. The sweep slice equals the
 * age ceiling, so a model read on day d is due again on day d + 6 by both rules,
 * and missed runs can only make the age rule fire earlier. A model's slice comes
 * from its key, not its list position, so a model appearing or disappearing
 * never moves the others to another day.
 */
export const MODEL_CENSUS_DAY_MS = 24 * 60 * 60 * 1000;
export const MODEL_CENSUS_SWEEP_DAYS = 6;

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
  page: Page;
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
  | "stale"
  | "sweep";

export type ModelCensusDecision<Page> =
  | { kind: "read"; reason: ModelCensusReadReason }
  | { kind: "carry"; evidence: ModelCensusEvidence<Page> };

export type ModelCensusPrevious<Page> =
  | { kind: "cold"; warning: string | null }
  | { kind: "incremental"; census: ModelCensus<Page> };

const day = z.number().int().nonnegative().safe();

/** Stable sweep slice for a model key (32-bit FNV-1a). */
function slice(key: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % MODEL_CENSUS_SWEEP_DAYS;
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

function plan<Page>(
  controls: readonly ModelCensusControl[],
  previous: ModelCensus<Page> | null,
  today: number,
  triggers: ReadonlySet<string> = new Set(),
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

  /** Terminal census for the next run: fresh reads are dated today, carried
   * evidence keeps its original read day. */
  accept<Page>(
    contract: string,
    today: number,
    controls: readonly ModelCensusControl[],
    pages: readonly Page[],
    decisions: readonly ModelCensusDecision<Page>[],
  ): ModelCensus<Page> {
    if (
      pages.length !== controls.length ||
      decisions.length !== controls.length
    )
      throw new Error(
        `Model census cannot close: ${pages.length} pages and ${decisions.length} decisions for ${controls.length} published models`,
      );
    return {
      contract,
      day: today,
      models: controls.map((control, index) => {
        const decision = decisions[index];
        const page = pages[index];
        if (!decision || page === undefined)
          throw new Error("Model census evidence is missing a published model");
        return {
          key: control.key,
          count: control.count,
          readDay:
            decision.kind === "carry" ? decision.evidence.readDay : today,
          page,
        };
      }),
    };
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
