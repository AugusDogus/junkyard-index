import { z } from "zod";
import {
  aviationHash,
  AviationControlSchema,
  AviationPageSchema,
  type AviationControl,
  type AviationPage,
} from "./aviation-parser";
import { aviationModels, type AviationMake } from "./aviation-snapshot";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";
import {
  AVIATION_CONTACT,
  AVIATION_MAKES,
  AVIATION_ORIGIN,
  AVIATION_YARD,
  aviationBrowsePath,
} from "./aviation-yard-metadata";

// Room for the previous census plus this run's pages (about 0.4 MiB each today),
// and for both at the 10000-row checkpoint ceiling.
export const AVIATION_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
export const AVIATION_MAX_REQUESTS = 650;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = aviationHash({
  version: 1,
  yard: AVIATION_YARD,
  authority:
    "literal-model-graph/native-arrival-union/all-conflicts-quarantined/incremental-model-census-v2",
});
/** Every model page read by an accepted run, carried forward by the next one. */
// A page failing its fingerprint makes the terminal cursor unreadable, so the
// next run starts a warned cold census instead of failing on the carried page.
export const AviationCensusSchema = ModelCensus.schema(
  AviationPageSchema,
  512,
).superRefine((census, context) => {
  if (census.models.some((m) => m.page.hash !== aviationHash(m.page.records)))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aviation census card fingerprint changed",
    });
});
export type AviationCensus = z.infer<typeof AviationCensusSchema>;
const MakeSchema = AviationControlSchema.extend({
  models: z.array(AviationControlSchema).max(128).nullable(),
});
const progress = z
  .object({
    source: z.literal("aviation"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum([
      "contact",
      "root",
      "directory",
      "configured",
      "makes",
      "models",
      "closing",
    ]),
    contact: hash.nullable(),
    makes: z.array(MakeSchema).max(64),
    pages: z.array(AviationPageSchema).max(512),
    arrivals: z.array(AviationPageSchema).max(1),
    closing: z.number().int().min(0).max(200),
    requests: z.number().int().min(0).max(AVIATION_MAX_REQUESTS),
    /** UTC run day fixed before the first request; null only in the initial cursor. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: AviationCensusSchema.nullable(),
  })
  .strict();
export type AviationProgress = z.infer<typeof progress>;
export type AviationClosingControl =
  | { kind: "contact"; url: typeof AVIATION_CONTACT }
  | { kind: "directory"; url: typeof AVIATION_MAKES }
  | {
      kind: "model";
      url: string;
      make: AviationMake;
      model: AviationControl;
      index: number;
    };

/** Closing re-reads ownership, the live make directory and every model read
 * this run whose cards differ from its badge, so a short page is confirmed
 * before it can be carried. The WPO-cached `/parts/` copy and root are not
 * re-read: their equality proves only that the page cache did not rebuild.
 * Carried pages were confirmed on the run that read them; other per-model
 * changes surface as count changes in the next run's opening menus. */
export function aviationClosingControls(
  state: Pick<AviationProgress, "makes" | "pages" | "previous" | "day">,
): AviationClosingControl[] {
  const models = aviationModels(state.makes);
  const decisions =
    state.day === null || state.pages.length !== models.length
      ? []
      : aviationCensusPlan(state);
  const mismatched = decisions.flatMap((decision, index) => {
    const value = models[index];
    return decision.kind === "read" &&
      value &&
      state.pages[index]?.records.length !== value.model.count
      ? [
          {
            kind: "model" as const,
            url: AVIATION_ORIGIN + value.model.path,
            make: value.make,
            model: value.model,
            index,
          },
        ]
      : [];
  });
  return [
    { kind: "contact", url: AVIATION_CONTACT },
    { kind: "directory", url: AVIATION_MAKES },
    ...mismatched,
  ];
}

/** Keys bind every field the model parser and snapshot bind to: the parent make
 * path and label and the model path and label. */
function aviationCensusControls(
  makes: readonly AviationMake[],
): ModelCensusControl[] {
  return aviationModels(makes).map(({ make, model }) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    count: model.count,
  }));
}

/** Read or carry each published model. Arrivals never trigger a read: they are
 * unioned into every snapshot already, and many stay absent from their own model
 * page for weeks, so a trigger would re-read the same models every day. */
export function aviationCensusPlan(
  state: Pick<AviationProgress, "makes" | "previous" | "day">,
): ModelCensusDecision<AviationPage>[] {
  if (state.day === null)
    throw new Error("Aviation census plan needs a run day");
  return ModelCensus.plan(
    aviationCensusControls(state.makes),
    state.previous,
    state.day,
    { cards: aviationCards },
  );
}

/** Cards a model page lists; closing compares the same count with the badge. */
const aviationCards = (page: AviationPage) => page.records.length;
/** Every Nov 12 model list held at least its published count (2,482 of 2,482
 * badge cards on 404 models; 32 lists exceed their badge by 42 cards), and Nov
 * 19 badge changes matched card changes. A sweep slice cut to one card per
 * model leaves 82.8% to 88.6% of the badges, so 95% fails the first such day. */
export const AVIATION_MINIMUM_BADGE_COVERAGE = 0.95;

/** Fails a run whose read and carried model cards fall short of today's model
 * counts, before anything is published. */
export function aviationCoverageError(
  state: Pick<AviationProgress, "makes" | "pages">,
): string | null {
  const models = aviationModels(state.makes);
  return ModelCensus.coverage(
    "Aviation",
    aviationCensusControls(state.makes),
    state.pages,
    aviationCards,
    AVIATION_MINIMUM_BADGE_COVERAGE,
    (index) => {
      const value = models[index];
      return value ? value.make.label + " " + value.model.label : "?";
    },
  );
}

/** Terminal census for a fully closed run. */
export function aviationCensus(state: AviationProgress): AviationCensus {
  if (state.day === null) throw new Error("Aviation census has no run day");
  return ModelCensus.accept(
    scope,
    state.day,
    aviationCensusControls(state.makes),
    state.pages,
    aviationCensusPlan(state),
    // Closing re-reads every mismatched page read this run and fails on a change.
    "confirmed",
    aviationCards,
  );
}

function checksum(
  state: Omit<AviationProgress, "checksum"> | AviationProgress,
) {
  return aviationHash({
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

export const AviationCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("aviation"),
        version: z.literal(1),
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: AviationCensusSchema.optional(),
      })
      .strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > AVIATION_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error("Aviation cursor size or integrity changed");
      const stages = [
        "contact",
        "root",
        "directory",
        "configured",
        "makes",
        "models",
        "closing",
      ];
      const stage = stages.indexOf(state.phase);
      const models = aviationModels(state.makes);
      const completedMakes = state.makes.filter(
        (m) => m.models !== null,
      ).length;
      if (
        (stage === 0) !== (state.contact === null) ||
        state.arrivals.length !== (stage < 2 ? 0 : 1)
      )
        throw new Error("Aviation owner/root phase evidence is inconsistent");
      if (
        stage < 3 !== (state.makes.length === 0) ||
        completedMakes !==
          (stage < 4 ? 0 : stage === 4 ? completedMakes : state.makes.length) ||
        state.makes.slice(0, completedMakes).some((m) => m.models === null) ||
        state.makes.slice(completedMakes).some((m) => m.models !== null)
      )
        throw new Error(
          "Aviation make directory evidence is not a contiguous published prefix",
        );
      if (
        models.length > 512 ||
        state.pages.length > models.length ||
        (stage < 5 && state.pages.length !== 0) ||
        (stage === 5 && state.pages.length >= models.length) ||
        (stage === 6 && state.pages.length !== models.length) ||
        (stage === 4 && completedMakes >= state.makes.length)
      )
        throw new Error("Aviation model page phase/order is inconsistent");
      if (
        state.day === null
          ? state.requests !== 0 || state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== scope ||
              state.previous.day > state.day)
      )
        throw new Error("Aviation run day or previous census is inconsistent");
      // Carried pages are exactly the previous census evidence and cost no GET.
      let readPages = 0;
      if (stage >= 5) {
        const decisions = aviationCensusPlan(state);
        state.pages.forEach((page, index) => {
          const decision = decisions[index];
          if (decision?.kind === "read") readPages++;
          else if (decision?.evidence.page.hash !== page.hash)
            throw new Error(
              "Aviation carried model page differs from its census",
            );
        });
        if (stage === 5 && decisions[state.pages.length]?.kind !== "read")
          throw new Error("Aviation next model page is not due for a read");
      }
      if (
        (stage < 6 && state.closing !== 0) ||
        (stage === 6 && state.closing > aviationClosingControls(state).length)
      )
        throw new Error("Aviation closing control prefix is inconsistent");
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          state.arrivals.length +
          (state.makes.length ? 1 : 0) +
          (stage >= 4 ? 1 : 0) +
          completedMakes +
          readPages +
          state.closing
      )
        throw new Error("Aviation request accounting is inconsistent");
      if (
        new Set(state.makes.map((m) => m.path)).size !== state.makes.length ||
        new Set(models.map((m) => m.model.path)).size !== models.length
      )
        throw new Error(
          "Aviation checkpoint repeats a native directory destination",
        );
      for (const make of state.makes) {
        if (aviationBrowsePath(AVIATION_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Invalid Aviation make destination");
        for (const model of make.models ?? [])
          if (
            aviationBrowsePath(AVIATION_ORIGIN + model.path, 2) !==
              model.path ||
            !model.path.startsWith(make.path + "/")
          )
            throw new Error("Invalid Aviation model destination binding");
      }
      if (state.pages.reduce((n, p) => n + p.records.length, 0) > 10_000)
        throw new Error("Aviation checkpoint exceeds 10000 raw model rows");
      for (const page of [...state.pages, ...state.arrivals])
        if (page.hash !== aviationHash(page.records))
          throw new Error("Aviation native record fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Aviation native checkpoint",
      });
    }
  });
export type AviationCursor = z.infer<typeof AviationCursorSchema>;
const initial: Omit<AviationProgress, "checksum"> = {
  source: "aviation",
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
export const AviationCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): AviationCursor {
    if (Buffer.byteLength(value) > AVIATION_MAX_CURSOR_BYTES)
      throw new Error(
        "Aviation cursor wire payload exceeds 4 MiB; keep the last validated checkpoint",
      );
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      throw new Error(
        "Aviation cursor wire payload is not valid JSON; keep the last validated checkpoint",
      );
    }
    return AviationCursorSchema.parse(candidate);
  },
  serialize(cursor: AviationCursor): string {
    const value = JSON.stringify(AviationCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > AVIATION_MAX_CURSOR_BYTES)
      throw new Error(
        "Aviation cursor wire payload exceeds 4 MiB; keep the last validated checkpoint",
      );
    return value;
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: AviationProgress,
    now: number,
    previousCursor: unknown,
  ): { cursor: AviationProgress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = AviationCursorSchema.safeParse(previousCursor ?? undefined);
    const previous =
      parsed.success && parsed.data.phase === "complete"
        ? ModelCensus.previous(parsed.data.census, scope, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous Aviation checkpoint is not a readable terminal census; reading every model page.",
          };
    return {
      cursor: AviationCursor.checkpoint({
        ...cursor,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
  checkpoint(
    state: Omit<AviationProgress, "checksum"> | AviationProgress,
  ): AviationProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = AviationCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Aviation checkpoint");
    return parsed;
  },
} as const satisfies {
  initial: AviationProgress;
  parse: (value: string) => AviationCursor;
  serialize: (cursor: AviationCursor) => string;
  begin: (
    cursor: AviationProgress,
    now: number,
    previousCursor: unknown,
  ) => { cursor: AviationProgress; warning: string | null };
  checkpoint: (
    state: Omit<AviationProgress, "checksum"> | AviationProgress,
  ) => AviationProgress;
};
