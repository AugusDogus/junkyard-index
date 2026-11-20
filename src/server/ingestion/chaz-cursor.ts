import { z } from "zod";
import {
  chazHash,
  ChazControlSchema,
  ChazPageSchema,
  type ChazControl,
  type ChazPage,
} from "./chaz-parser";
import { chazModels, type ChazMake } from "./chaz-snapshot";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";
import {
  CHAZ_CONTACT,
  CHAZ_MAKES,
  CHAZ_ORIGIN,
  CHAZ_YARD,
  chazBrowsePath,
} from "./chaz-yard-metadata";

// A full in-run cursor peaked at about 180 KB in the 248-model replay; the
// previous census adds about the same again, well inside 1 MiB.
export const CHAZ_MAX_CURSOR_BYTES = 1024 * 1024;
export const CHAZ_MAX_REQUESTS = 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = chazHash({
  version: 1,
  yard: CHAZ_YARD,
  authority:
    "literal-model-graph/native-arrival-union/all-conflicts-quarantined/incremental-model-census-v3",
});
/** Every model page read by an accepted run, carried forward by the next one. */
// A page failing its fingerprint makes the terminal cursor unreadable, so the
// next run starts a warned cold census instead of failing on the carried page.
export const ChazCensusSchema = ModelCensus.schema(
  ChazPageSchema,
  512,
).superRefine((census, context) => {
  if (census.models.some((m) => m.page.hash !== chazHash(m.page.records)))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Chaz census card fingerprint changed",
    });
});
export type ChazCensus = z.infer<typeof ChazCensusSchema>;
const MakeSchema = ChazControlSchema.extend({
  models: z.array(ChazControlSchema).max(128).nullable(),
});
const progress = z
  .object({
    source: z.literal("chaz"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum([
      "contact",
      "root",
      "directory",
      "makes",
      "models",
      "closing",
    ]),
    contact: hash.nullable(),
    makes: z.array(MakeSchema).max(64),
    pages: z.array(ChazPageSchema).max(512),
    arrivals: z.array(ChazPageSchema).max(1),
    closing: z.number().int().min(0).max(1024),
    requests: z.number().int().min(0).max(CHAZ_MAX_REQUESTS),
    /** UTC run day fixed before the first request; null only in the initial cursor. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: ChazCensusSchema.nullable(),
  })
  .strict();
export type ChazProgress = z.infer<typeof progress>;
export type ChazClosingControl =
  | { kind: "contact"; url: typeof CHAZ_CONTACT }
  | { kind: "directory"; url: typeof CHAZ_MAKES }
  | {
      kind: "model";
      url: string;
      make: ChazMake;
      model: ChazControl;
      index: number;
    };

/** Closing re-reads ownership, the make directory and every model read this
 * run whose cards differ from its badge or fall below its expected count
 * (ModelCensus.closingReads), so a short page is confirmed before it can be
 * carried. Carried pages were confirmed on the run that read them; other
 * per-model changes surface as badge changes in the next run's opening menus.
 * Persistent discrepancies, such as the dead `&` routes, re-read identically. */
export function chazClosingControls(
  state: Pick<
    ChazProgress,
    "makes" | "pages" | "arrivals" | "previous" | "day"
  >,
): ChazClosingControl[] {
  const models = chazModels(state.makes);
  const decisions =
    state.day === null || state.pages.length !== models.length
      ? []
      : chazCensusPlan(state);
  const mismatched = decisions.length
    ? ModelCensus.closingReads({
        controls: chazCensusControls(state.makes),
        pages: state.pages,
        decisions,
        previous: state.previous,
        cards: chazCards,
      }).flatMap((index) => {
        const value = models[index];
        return value
          ? [
              {
                kind: "model" as const,
                url: CHAZ_ORIGIN + value.model.path,
                make: value.make,
                model: value.model,
                index,
              },
            ]
          : [];
      })
    : [];
  return [
    { kind: "contact", url: CHAZ_CONTACT },
    { kind: "directory", url: CHAZ_MAKES },
    ...mismatched,
  ];
}

/** The model page parser binds both paths and both labels. */
function chazCensusControls(makes: readonly ChazMake[]): ModelCensusControl[] {
  return chazModels(makes).map(({ make, model }) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    count: model.count,
  }));
}

/** UTC day of a labelled `YYYY-MM-DD` Enter Date, or null when unusable. */
function enterDay(value: string | null): number | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isNaN(time) ? null : ModelCensus.day(time);
}

/**
 * Read or carry each published model. A carried model is also read when a
 * recent arrival whose own destination
 * binds to it is missing from its carried page and was entered no earlier than
 * the day before the previous accepted run. About 15% of arrivals never reach
 * their model page, so an unbounded trigger would re-read those models every
 * day for the 21-day arrival window; the Enter Date bound fires each such
 * arrival at most twice. Arrival donors are published from the arrival page
 * either way, and older swaps wait for the six-day sweep.
 */
export function chazCensusPlan(
  state: Pick<ChazProgress, "makes" | "arrivals" | "previous" | "day">,
): ModelCensusDecision<ChazPage>[] {
  if (state.day === null) throw new Error("Chaz census plan needs a run day");
  const controls = chazCensusControls(state.makes);
  const models = chazModels(state.makes);
  const previous = state.previous;
  const triggers = new Set<string>();
  if (previous) {
    const carried = new Map(previous.models.map((m) => [m.key, m.page]));
    for (const record of state.arrivals[0]?.records ?? []) {
      const entered = enterDay(record[6]);
      if (entered === null || entered < previous.day - 1) continue;
      const path = record[4].startsWith(CHAZ_ORIGIN)
        ? record[4].slice(CHAZ_ORIGIN.length)
        : record[4];
      const parent = path.split("/").slice(0, -2).join("/");
      const index = models.findIndex(
        (m) => m.model.path.replace(/\/$/, "") === parent,
      );
      const key = controls[index]?.key;
      if (key && !carried.get(key)?.records.some((r) => r[0] === record[0]))
        triggers.add(key);
    }
  }
  return ModelCensus.plan(controls, previous, state.day, {
    cards: chazCards,
    triggers,
  });
}

const chazCards = (page: ChazPage) => page.records.length;
/** Healthy captures cover 94.2% (Nov 12, 1,106 of 1,174 badge cards; 68
 * unexplained overcounts on 46 models) and 99.3% (Nov 18 opening, 1,108 of
 * 1,116 with the unread 73-model tail at its badge; only the dead TOWN & COUNTRY
 * route short). Emptying one sweep slice drops those to at most 86.2% and
 * 90.9% (the smallest slice holds 8 to 9% of badge cards). Cutting Nov 18's
 * lightest slice to one card per page still covers 93.5% of badges; the shared
 * replay floor catches it (94.1% of the last accepted cards, below 97%). */
export const CHAZ_MINIMUM_BADGE_COVERAGE = 0.92;

/** Fails a run whose read and carried model cards fall short of today's model
 * counts, before anything is published. */
export function chazCoverageError(state: ChazProgress): string | null {
  const models = chazModels(state.makes);
  return ModelCensus.coverage(
    "Chaz",
    {
      controls: chazCensusControls(state.makes),
      pages: state.pages,
      day: state.day,
      previous: state.previous,
      cards: chazCards,
    },
    CHAZ_MINIMUM_BADGE_COVERAGE,
    (index) => {
      const value = models[index];
      return value ? value.make.label + " " + value.model.label : "?";
    },
  );
}

/** Terminal census for a fully closed run. */
export function chazCensus(state: ChazProgress): ChazCensus {
  if (state.day === null) throw new Error("Chaz census has no run day");
  return ModelCensus.accept(
    scope,
    state.day,
    {
      controls: chazCensusControls(state.makes),
      pages: state.pages,
      decisions: chazCensusPlan(state),
      previous: state.previous,
      cards: chazCards,
    },
    // Closing re-reads every short page read this run and fails on a change.
    "confirmed",
  );
}

function checksum(state: Omit<ChazProgress, "checksum"> | ChazProgress) {
  return chazHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    contact: state.contact,
    makes: state.makes,
    pages: state.pages,
    arrivals: state.arrivals,
    closing: state.closing,
    requests: state.requests,
    day: state.day,
    previous: state.previous,
  });
}

export const ChazCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("chaz"),
        version: z.literal(1),
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: ChazCensusSchema.optional(),
      })
      .strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > CHAZ_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error("Chaz cursor size or integrity changed");
      const stages = [
        "contact",
        "root",
        "directory",
        "makes",
        "models",
        "closing",
      ];
      const stage = stages.indexOf(state.phase);
      const models = chazModels(state.makes);
      const completedMakes = state.makes.filter(
        (m) => m.models !== null,
      ).length;
      if (
        (stage === 0) !== (state.contact === null) ||
        state.arrivals.length !== (stage < 2 ? 0 : 1)
      )
        throw new Error("Chaz owner/root phase evidence is inconsistent");
      if (
        stage < 3 !== (state.makes.length === 0) ||
        completedMakes !==
          (stage < 3 ? 0 : stage === 3 ? completedMakes : state.makes.length) ||
        state.makes.slice(0, completedMakes).some((m) => m.models === null) ||
        state.makes.slice(completedMakes).some((m) => m.models !== null)
      )
        throw new Error(
          "Chaz make directory evidence is not a contiguous published prefix",
        );
      if (
        models.length > 512 ||
        state.pages.length > models.length ||
        (stage < 4 && state.pages.length !== 0) ||
        (stage === 4 && state.pages.length >= models.length) ||
        (stage === 5 && state.pages.length !== models.length) ||
        (stage === 3 && completedMakes >= state.makes.length)
      )
        throw new Error("Chaz model page phase/order is inconsistent");
      if (
        state.day === null
          ? state.requests !== 0 || state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== scope ||
              state.previous.day > state.day)
      )
        throw new Error("Chaz run day or previous census is inconsistent");
      // Carried pages are exactly the previous census evidence and cost no GET.
      let readPages = 0;
      if (stage >= 4) {
        const decisions = chazCensusPlan(state);
        state.pages.forEach((page, index) => {
          const decision = decisions[index];
          if (decision?.kind === "read") readPages++;
          else if (decision?.evidence.page.hash !== page.hash)
            throw new Error("Chaz carried model page differs from its census");
        });
        if (stage === 4 && decisions[state.pages.length]?.kind !== "read")
          throw new Error("Chaz next model page is not due for a read");
      }
      if (
        (stage < 5 && state.closing !== 0) ||
        (stage === 5 && state.closing > chazClosingControls(state).length)
      )
        throw new Error("Chaz closing control prefix is inconsistent");
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          state.arrivals.length +
          (state.makes.length ? 1 : 0) +
          completedMakes +
          readPages +
          state.closing
      )
        throw new Error("Chaz request accounting is inconsistent");
      if (
        new Set(state.makes.map((m) => m.path)).size !== state.makes.length ||
        new Set(models.map((m) => m.model.path)).size !== models.length
      )
        throw new Error(
          "Chaz checkpoint repeats a native directory destination",
        );
      for (const make of state.makes) {
        if (chazBrowsePath(CHAZ_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Invalid Chaz make destination");
        for (const model of make.models ?? [])
          if (
            chazBrowsePath(CHAZ_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error("Invalid Chaz model destination binding");
      }
      if (state.pages.reduce((n, p) => n + p.records.length, 0) > 10_000)
        throw new Error("Chaz checkpoint exceeds 10000 raw model rows");
      for (const page of [...state.pages, ...state.arrivals])
        if (page.hash !== chazHash(page.records))
          throw new Error("Chaz native record fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Chaz native checkpoint",
      });
    }
  });
export type ChazCursor = z.infer<typeof ChazCursorSchema>;
const initial: Omit<ChazProgress, "checksum"> = {
  source: "chaz",
  version: 1,
  scope,
  phase: "contact",
  contact: null,
  makes: [],
  pages: [],
  arrivals: [],
  closing: 0,
  requests: 0,
  day: null,
  previous: null,
};
export const ChazCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): ChazCursor {
    if (Buffer.byteLength(value) > CHAZ_MAX_CURSOR_BYTES)
      throw new Error(
        "Chaz cursor wire payload exceeds 1 MiB; keep the last validated checkpoint",
      );
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      throw new Error(
        "Chaz cursor wire payload is not valid JSON; keep the last validated checkpoint",
      );
    }
    return ChazCursorSchema.parse(candidate);
  },
  serialize(cursor: ChazCursor): string {
    const value = JSON.stringify(ChazCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > CHAZ_MAX_CURSOR_BYTES)
      throw new Error(
        "Chaz cursor wire payload exceeds 1 MiB; keep the last validated checkpoint",
      );
    return value;
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: ChazProgress,
    now: number,
    previousCursor: unknown,
  ): { cursor: ChazProgress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = ChazCursorSchema.safeParse(previousCursor ?? undefined);
    const previous =
      parsed.success && parsed.data.phase === "complete"
        ? ModelCensus.previous(parsed.data.census, scope, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous Chaz checkpoint is not a readable terminal census; reading every model page.",
          };
    return {
      cursor: ChazCursor.checkpoint({
        ...cursor,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
  checkpoint(
    state: Omit<ChazProgress, "checksum"> | ChazProgress,
  ): ChazProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = ChazCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Chaz checkpoint");
    return parsed;
  },
} as const satisfies {
  initial: ChazProgress;
  parse: (value: string) => ChazCursor;
  serialize: (cursor: ChazCursor) => string;
  begin: (
    cursor: ChazProgress,
    now: number,
    previousCursor: unknown,
  ) => { cursor: ChazProgress; warning: string | null };
  checkpoint: (
    state: Omit<ChazProgress, "checksum"> | ChazProgress,
  ) => ChazProgress;
};
