import { z } from "zod";
import {
  scottsHash,
  ScottsControlSchema,
  ScottsPageSchema,
  type ScottsControl,
  type ScottsPage,
} from "./scotts-parser";
import { scottsModels, type ScottsMake } from "./scotts-snapshot";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";
import {
  SCOTTS_ROOT,
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  SCOTTS_YARD,
  scottsBrowsePath,
} from "./scotts-yard-metadata";

// Holds this run's pages plus the previous census: about 0.2 MiB each for the
// 1,064-card Nov 15 graph, so roughly 0.5 MiB in all, well inside 2 MiB.
export const SCOTTS_MAX_CURSOR_BYTES = 2 * 1024 * 1024;
export const SCOTTS_MAX_REQUESTS = 600;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = scottsHash({
  version: 1,
  yard: SCOTTS_YARD,
  contract:
    "CC68,XX00/literal-premium-model-graph/required-card-id/all-required-destination-conflicts-quarantined/incremental-model-census-v3",
});
/** Every model page held by an accepted run: the next run reference for read
 * reasons, expected cards, closing floors and replay coverage.
 * Stored cards must still match their own fingerprint. */
export const ScottsCensusSchema = ModelCensus.schema(
  ScottsPageSchema,
  1024,
).superRefine((census, context) => {
  if (census.models.some(({ page }) => page.hash !== scottsHash(page.records)))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Scotts census card fingerprint changed",
    });
});
export type ScottsCensus = z.infer<typeof ScottsCensusSchema>;
const progress = z
  .object({
    source: z.literal("scotts"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["root", "directory", "makes", "models", "closing"]),
    root: hash.nullable(),
    makes: z
      .array(
        ScottsControlSchema.extend({
          models: z.array(ScottsControlSchema).max(128).nullable(),
        }),
      )
      .max(64),
    pages: z.array(ScottsPageSchema).max(1024),
    closing: z.number().int().min(0).max(1100),
    requests: z.number().int().min(0).max(SCOTTS_MAX_REQUESTS),
    /** UTC run day fixed before the first request; null only in the initial cursor. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: ScottsCensusSchema.nullable(),
  })
  .strict();
export type ScottsProgress = z.infer<typeof progress>;
export type ScottsClosingControl =
  | { kind: "root"; url: typeof SCOTTS_ROOT }
  | { kind: "directory"; url: typeof SCOTTS_MAKES }
  | {
      kind: "model";
      url: string;
      make: ScottsMake;
      model: ScottsControl;
      index: number;
    };

/** Closing re-reads ownership, the make directory and every model read this run
 * whose cards differ from its badge or fall below its expected count
 * (ModelCensus.closingReads), so a short page is confirmed by an identical
 * re-read in the run that reads it. A page that keeps an NOF placeholder but
 * loses a donor matches its badge and is still re-read. Other per-model changes
 * surface as badge changes in the next run's opening menus. */
export function scottsClosingControls(
  state: Pick<ScottsProgress, "makes" | "pages" | "previous" | "day">,
): ScottsClosingControl[] {
  const models = scottsModels(state.makes);
  const decisions =
    state.day === null || state.pages.length !== models.length
      ? []
      : scottsCensusPlan(state);
  const mismatched = decisions.length
    ? ModelCensus.closingReads({
        controls: scottsCensusControls(state.makes),
        pages: state.pages,
        decisions,
        previous: state.previous,
        cards: scottsCards,
      }).flatMap((index) => {
        const value = models[index];
        return value
          ? [
              {
                kind: "model" as const,
                url: SCOTTS_ORIGIN + value.model.path,
                make: value.make,
                model: value.model,
                index,
              },
            ]
          : [];
      })
    : [];
  return [
    { kind: "root", url: SCOTTS_ROOT },
    { kind: "directory", url: SCOTTS_MAKES },
    ...mismatched,
  ];
}

// The model parser and snapshot bind make path and label plus model path and
// label, so carried cards are reused only under that exact published context.
function scottsCensusControls(
  makes: readonly ScottsMake[],
): ModelCensusControl[] {
  return scottsModels(makes).map(({ make, model }) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    count: model.count,
  }));
}

/** Read every published model on every run (`reuse: "never"`): an unchanged
 * badge can hide a donor swapped under it. Scotts publishes no usable
 * arrivals feed (the route times out), so no read is labelled `trigger`. */
export function scottsCensusPlan(
  state: Pick<ScottsProgress, "makes" | "previous" | "day">,
): ModelCensusDecision<ScottsPage>[] {
  if (state.day === null) throw new Error("Scotts census plan needs a run day");
  return ModelCensus.plan(
    scottsCensusControls(state.makes),
    state.previous,
    state.day,
    { cards: scottsCards, reuse: "never" },
  );
}

/** Cards a model page lists, as closing compares them with the badge. NOF
 * placeholder cards are listed but never counted by badges. */
const scottsCards = (page: ScottsPage) => page.records.length;
/** Every model badge was covered by its cards in the Nov 15 census (1,058 of
 * 1,058 on 221 models; the six NOF placeholders only add cards), and the four
 * pages re-read on Nov 19 matched their new badges exactly, so the 5% margin
 * (about 53 cards) far exceeds the observed 0.8 card changes a day. The
 * smallest real sweep slice holds 9.8% of badges (35 models, 104 badges):
 * breaking it leaves at most 90.2% covered, or 93.5% (989 of 1,058) if each of
 * its pages still lists one card. Against the Nov 15 cards (1,064), that cut
 * leaves 93.4% (994), below the 97% replay floor too. */
export const SCOTTS_MINIMUM_BADGE_COVERAGE = 0.95;

/** Fails a run whose read and carried model cards fall short of today's model
 * badges, or of the last accepted cards of models whose badge is unchanged,
 * before anything is published. */
export function scottsCoverageError(state: ScottsProgress): string | null {
  const models = scottsModels(state.makes);
  return ModelCensus.coverage(
    "Scotts",
    {
      controls: scottsCensusControls(state.makes),
      pages: state.pages,
      day: state.day,
      previous: state.previous,
      cards: scottsCards,
    },
    SCOTTS_MINIMUM_BADGE_COVERAGE,
    (index) => {
      const value = models[index];
      return value ? value.make.label + " " + value.model.label : "?";
    },
  );
}

/** Terminal census for a fully closed run. */
export function scottsCensus(state: ScottsProgress): ScottsCensus {
  if (state.day === null) throw new Error("Scotts census has no run day");
  return ModelCensus.accept(
    scope,
    state.day,
    {
      controls: scottsCensusControls(state.makes),
      pages: state.pages,
      decisions: scottsCensusPlan(state),
      previous: state.previous,
      cards: scottsCards,
    },
    // Closing re-reads every page read this run whose cards differ from its
    // badge or fall below its expected count and fails on any change.
    "confirmed",
  );
}

function checksum(state: Omit<ScottsProgress, "checksum"> | ScottsProgress) {
  return scottsHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    root: state.root,
    makes: state.makes,
    pages: state.pages,
    closing: state.closing,
    requests: state.requests,
    day: state.day,
    previous: state.previous,
  });
}

export const ScottsCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("scotts"),
        version: z.literal(1),
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: ScottsCensusSchema.optional(),
      })
      .strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > SCOTTS_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "Scotts checkpoint exceeds 2 MiB or its integrity changed",
        );
      const stage = ["root", "directory", "makes", "models", "closing"].indexOf(
        state.phase,
      );
      const completed = state.makes.filter(
        (make) => make.models !== null,
      ).length;
      const models = scottsModels(state.makes);
      if (
        (stage === 0) !== (state.root === null) ||
        stage < 2 !== (state.makes.length === 0) ||
        state.makes.slice(0, completed).some((make) => make.models === null) ||
        state.makes.slice(completed).some((make) => make.models !== null) ||
        (stage < 2 && completed !== 0) ||
        (stage === 2 && completed >= state.makes.length) ||
        (stage > 2 && completed !== state.makes.length)
      )
        throw new Error(
          "Scotts checkpoint is not a contiguous native root/make prefix",
        );
      if (
        models.length > 1024 ||
        state.pages.length > models.length ||
        (stage < 3 && state.pages.length !== 0) ||
        (stage === 3 && state.pages.length >= models.length) ||
        (stage === 4 && state.pages.length !== models.length) ||
        (stage < 4 && state.closing !== 0) ||
        (stage === 4 && state.closing > scottsClosingControls(state).length)
      )
        throw new Error(
          "Scotts model or closing checkpoint prefix is inconsistent",
        );
      if (
        state.day === null
          ? state.requests !== 0 || state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== scope ||
              state.previous.day > state.day)
      )
        throw new Error("Scotts run day or previous census is inconsistent");
      // Carried pages are exactly the previous census evidence and cost no GET.
      let readPages = 0;
      if (stage >= 3) {
        const decisions = scottsCensusPlan(state);
        state.pages.forEach((page, index) => {
          const decision = decisions[index];
          if (decision?.kind === "read") readPages++;
          else if (decision?.evidence.page.hash !== page.hash)
            throw new Error(
              "Scotts carried model page differs from its census",
            );
        });
        if (stage === 3 && decisions[state.pages.length]?.kind !== "read")
          throw new Error("Scotts next model page is not due for a read");
      }
      if (
        state.requests !==
        (state.root === null ? 0 : 1) +
          (state.makes.length ? 1 : 0) +
          completed +
          readPages +
          state.closing
      )
        throw new Error("Scotts checkpoint request accounting is inconsistent");
      if (
        new Set(state.makes.map((make) => make.path)).size !==
          state.makes.length ||
        new Set(models.map((entry) => entry.model.path)).size !== models.length
      )
        throw new Error(
          "Scotts checkpoint repeats a published directory destination",
        );
      for (const make of state.makes) {
        if (scottsBrowsePath(SCOTTS_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Scotts make destination changed");
        for (const model of make.models ?? [])
          if (
            scottsBrowsePath(SCOTTS_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error(
              "Scotts model destination lost its native make binding",
            );
      }
      if (
        state.pages.reduce((count, page) => count + page.records.length, 0) >
        20_000
      )
        throw new Error("Scotts checkpoint exceeds 20000 raw native cards");
      for (const page of state.pages)
        if (page.hash !== scottsHash(page.records))
          throw new Error("Scotts native card fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid Scotts checkpoint",
      });
    }
  });
export type ScottsCursor = z.infer<typeof ScottsCursorSchema>;
const initial: Omit<ScottsProgress, "checksum"> = {
  source: "scotts",
  version: 1,
  scope,
  phase: "root",
  root: null,
  makes: [],
  pages: [],
  closing: 0,
  requests: 0,
  day: null,
  previous: null,
};
function checkpoint(
  state: Omit<ScottsProgress, "checksum"> | ScottsProgress,
): ScottsProgress {
  const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
  const parsed = ScottsCursorSchema.parse({
    ...canonical,
    checksum: checksum(canonical),
  });
  if (parsed.phase === "complete")
    throw new Error("Expected a resumable Scotts checkpoint");
  return parsed;
}
export const ScottsCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): ScottsCursor {
    if (Buffer.byteLength(value) > SCOTTS_MAX_CURSOR_BYTES)
      throw new Error(
        "Scotts cursor exceeds 2 MiB; retain the last validated checkpoint",
      );
    const candidate: unknown = JSON.parse(value);
    return ScottsCursorSchema.parse(candidate);
  },
  serialize(cursor: ScottsCursor): string {
    const value = JSON.stringify(ScottsCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > SCOTTS_MAX_CURSOR_BYTES)
      throw new Error(
        "Scotts cursor exceeds 2 MiB; retain the last validated checkpoint",
      );
    return value;
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: ScottsProgress,
    now: number,
    previousCursor: unknown,
  ): { cursor: ScottsProgress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = ScottsCursorSchema.safeParse(previousCursor ?? undefined);
    const previous =
      parsed.success && parsed.data.phase === "complete"
        ? ModelCensus.previous(parsed.data.census, scope, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous Scotts checkpoint is not a readable terminal census; reading every model page.",
          };
    return {
      cursor: checkpoint({
        ...cursor,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
  checkpoint,
} as const;
