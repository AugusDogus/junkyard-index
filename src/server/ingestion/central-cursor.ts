import { z } from "zod";
import {
  centralHash,
  CentralControlSchema,
  CentralPageSchema,
  type CentralControl,
  type CentralPage,
} from "./central-parser";
import { centralModels, type CentralMake } from "./central-snapshot";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
  type ModelCensusRun,
} from "./model-census";
import {
  CENTRAL_ROOT,
  CENTRAL_MAKES,
  CENTRAL_ORIGIN,
  CENTRAL_YARD,
  centralBrowsePath,
} from "./central-yard-metadata";

// Room for the previous census plus this run's pages (about 0.8 MiB each at
// the saved 6,518-card graph).
export const CENTRAL_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
export const CENTRAL_MAX_REQUESTS = 1600;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = centralHash({
  version: 1,
  yard: CENTRAL_YARD,
  contract:
    "DD15/literal-premium-model-graph/all-required-destination-conflicts-quarantined/incremental-model-census-v3",
});
/** Every model page read by an accepted run, carried forward by the next one.
 * Each page must still match its own card fingerprint. */
export const CentralCensusSchema = ModelCensus.schema(
  CentralPageSchema,
  1024,
).superRefine((census, context) => {
  if (census.models.some((m) => m.page.hash !== centralHash(m.page.records)))
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Central census card fingerprint changed",
    });
});
export type CentralCensus = z.infer<typeof CentralCensusSchema>;
const progress = z
  .object({
    source: z.literal("central"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["root", "directory", "makes", "models", "closing"]),
    root: hash.nullable(),
    makes: z
      .array(
        CentralControlSchema.extend({
          models: z.array(CentralControlSchema).max(128).nullable(),
        }),
      )
      .max(64),
    pages: z.array(CentralPageSchema).max(1024),
    closing: z.number().int().min(0).max(1100),
    requests: z.number().int().min(0).max(CENTRAL_MAX_REQUESTS),
    /** UTC run day fixed before the first request; null only in the initial cursor. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: CentralCensusSchema.nullable(),
  })
  .strict();
export type CentralProgress = z.infer<typeof progress>;
export type CentralClosingControl =
  | { kind: "root"; url: typeof CENTRAL_ROOT }
  | { kind: "directory"; url: typeof CENTRAL_MAKES }
  | {
      kind: "model";
      url: string;
      make: CentralMake;
      model: CentralControl;
      index: number;
    };

/** Closing re-reads ownership, the make directory and every model read this
 * run whose cards differ from its badge or fall below its expected count
 * (ModelCensus.closingReads), so a short page that does not repeat is never
 * carried forward. Other per-model changes during the run surface as count
 * changes in the next run's opening menus. */
export function centralClosingControls(
  state: Pick<CentralProgress, "makes" | "pages" | "previous" | "day">,
): CentralClosingControl[] {
  const models = centralModels(state.makes);
  if (state.pages.length > models.length)
    throw new Error("Central closing model is outside the published graph");
  return [
    { kind: "root", url: CENTRAL_ROOT },
    { kind: "directory", url: CENTRAL_MAKES },
    ...ModelCensus.closingReads(centralCensusRun(state)).flatMap((index) => {
      const entry = models[index];
      return entry
        ? [
            {
              kind: "model",
              url: CENTRAL_ORIGIN + entry.model.path,
              ...entry,
              index,
            } satisfies CentralClosingControl,
          ]
        : [];
    }),
  ];
}

/** The key binds every control field the model parser and snapshot bind to. */
function centralCensusControls(
  makes: readonly CentralMake[],
): ModelCensusControl[] {
  return centralModels(makes).map(({ make, model }) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    count: model.count,
  }));
}

/** Read or carry each published model. The arrivals page omits about 38% of
 * new donors and is not parsed, so Central has no arrival triggers. */
export function centralCensusPlan(
  state: Pick<CentralProgress, "makes" | "previous" | "day">,
): ModelCensusDecision<CentralPage>[] {
  if (state.day === null)
    throw new Error("Central census plan needs a run day");
  return ModelCensus.plan(
    centralCensusControls(state.makes),
    state.previous,
    state.day,
    { cards: centralCards },
  );
}

/** Cards a model page lists, the count closing compares with its badge. */
const centralCards = (page: CentralPage) => page.records.length;

/** This run's controls, pages, decisions and the census it planned from. */
function centralCensusRun(
  state: Pick<CentralProgress, "makes" | "pages" | "previous" | "day">,
): ModelCensusRun<CentralPage> {
  return {
    controls: centralCensusControls(state.makes),
    pages: state.pages,
    decisions: centralCensusPlan(state),
    previous: state.previous,
    cards: centralCards,
  };
}

/** Every model in the saved 535-model census lists at least its badge (6,463
 * of 6,463 badge cards covered; the 44 mismatches are all surplus cards). A
 * fault that leaves each model of one sweep slice with a single card drops
 * badge coverage to between 81.9% and 89.9% across the six slices, and replay
 * coverage of the last accepted cards to between 81.8% and 89.9%. */
export const CENTRAL_MINIMUM_BADGE_COVERAGE = 0.95;

/** Fails a run whose read and carried model cards fall short of today's model
 * badges or of the last accepted cards of models whose badge is unchanged,
 * before anything is published. */
export function centralCoverageError(
  state: Pick<CentralProgress, "makes" | "pages" | "previous" | "day">,
): string | null {
  const models = centralModels(state.makes);
  return ModelCensus.coverage(
    "Central",
    {
      controls: centralCensusControls(state.makes),
      pages: state.pages,
      day: state.day,
      previous: state.previous,
      cards: centralCards,
    },
    CENTRAL_MINIMUM_BADGE_COVERAGE,
    (index) => {
      const entry = models[index];
      return entry ? entry.make.label + " " + entry.model.label : "?";
    },
  );
}

/** Terminal census for a fully closed run. */
export function centralCensus(state: CentralProgress): CentralCensus {
  if (state.day === null) throw new Error("Central census has no run day");
  return ModelCensus.accept(
    scope,
    state.day,
    centralCensusRun(state),
    // Closing re-reads every page closingReads names. It may only gain cards,
    // and only on a page that then lists more than its badge (see the
    // connector's closing), so every short page it stores was confirmed.
    "confirmed",
  );
}

function checksum(state: Omit<CentralProgress, "checksum"> | CentralProgress) {
  return centralHash({
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

export const CentralCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("central"),
        version: z.literal(1),
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: CentralCensusSchema.optional(),
      })
      .strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > CENTRAL_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "Central checkpoint exceeds 4 MiB or its integrity changed",
        );
      const stage = ["root", "directory", "makes", "models", "closing"].indexOf(
        state.phase,
      );
      const completed = state.makes.filter(
        (make) => make.models !== null,
      ).length;
      const models = centralModels(state.makes);
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
          "Central checkpoint is not a contiguous native root/make prefix",
        );
      if (
        models.length > 1024 ||
        state.pages.length > models.length ||
        (stage < 3 && state.pages.length !== 0) ||
        (stage === 3 && state.pages.length >= models.length) ||
        (stage === 4 && state.pages.length !== models.length) ||
        (stage < 4 && state.closing !== 0)
      )
        throw new Error(
          "Central model or closing checkpoint prefix is inconsistent",
        );
      if (
        state.day === null
          ? state.requests !== 0 || state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== scope ||
              state.previous.day > state.day)
      )
        throw new Error("Central run day or previous census is inconsistent");
      // Carried pages are exactly the previous census evidence and cost no GET.
      let readPages = 0;
      if (stage >= 3) {
        const decisions = centralCensusPlan(state);
        state.pages.forEach((page, index) => {
          const decision = decisions[index];
          if (decision?.kind === "read") readPages++;
          else if (
            !decision ||
            centralHash(decision.evidence.page) !== centralHash(page)
          )
            throw new Error(
              "Central carried model page differs from its census",
            );
        });
        if (stage === 3 && decisions[state.pages.length]?.kind !== "read")
          throw new Error("Central next model page is not due for a read");
        if (stage === 4 && state.closing > centralClosingControls(state).length)
          throw new Error(
            "Central model or closing checkpoint prefix is inconsistent",
          );
      }
      if (
        state.requests !==
        (state.root === null ? 0 : 1) +
          (state.makes.length ? 1 : 0) +
          completed +
          readPages +
          state.closing
      )
        throw new Error(
          "Central checkpoint request accounting is inconsistent",
        );
      if (
        new Set(state.makes.map((make) => make.path)).size !==
          state.makes.length ||
        new Set(models.map((entry) => entry.model.path)).size !== models.length
      )
        throw new Error(
          "Central checkpoint repeats a published directory destination",
        );
      for (const make of state.makes) {
        if (centralBrowsePath(CENTRAL_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Central make destination changed");
        for (const model of make.models ?? [])
          if (
            centralBrowsePath(CENTRAL_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error(
              "Central model destination lost its native make binding",
            );
      }
      if (
        state.pages.reduce((count, page) => count + page.records.length, 0) >
        20_000
      )
        throw new Error("Central checkpoint exceeds 20000 raw native cards");
      for (const page of state.pages)
        if (page.hash !== centralHash(page.records))
          throw new Error("Central native card fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid Central checkpoint",
      });
    }
  });
export type CentralCursor = z.infer<typeof CentralCursorSchema>;
const initial: Omit<CentralProgress, "checksum"> = {
  source: "central",
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
export const CentralCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): CentralCursor {
    if (Buffer.byteLength(value) > CENTRAL_MAX_CURSOR_BYTES)
      throw new Error(
        "Central cursor exceeds 4 MiB; retain the last validated checkpoint",
      );
    const candidate: unknown = JSON.parse(value);
    return CentralCursorSchema.parse(candidate);
  },
  serialize(cursor: CentralCursor): string {
    const value = JSON.stringify(CentralCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > CENTRAL_MAX_CURSOR_BYTES)
      throw new Error(
        "Central cursor exceeds 4 MiB; retain the last validated checkpoint",
      );
    return value;
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: CentralProgress,
    now: number,
    previousCursor: unknown,
  ): { cursor: CentralProgress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = CentralCursorSchema.safeParse(previousCursor ?? undefined);
    const previous =
      parsed.success && parsed.data.phase === "complete"
        ? ModelCensus.previous(parsed.data.census, scope, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous Central checkpoint is not a readable terminal census; reading every model page.",
          };
    return {
      cursor: CentralCursor.checkpoint({
        ...cursor,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
  checkpoint(
    state: Omit<CentralProgress, "checksum"> | CentralProgress,
  ): CentralProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = CentralCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Central checkpoint");
    return parsed;
  },
} as const;
