import { z } from "zod";
import {
  aplusHash,
  AplusControlSchema,
  AplusPageSchema,
  type AplusControl,
  type AplusPage,
} from "./aplus-parser";
import { aplusModels, type AplusMake } from "./aplus-snapshot";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";
import {
  APLUS_CONTACT,
  APLUS_MAKES,
  APLUS_ORIGIN,
  APLUS_YARD,
  aplusBrowsePath,
} from "./aplus-yard-metadata";

// Room for the previous census plus this run's pages (about 0.3 MiB each today).
export const APLUS_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
export const APLUS_MAX_REQUESTS = 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = aplusHash({
  version: 1,
  yard: APLUS_YARD,
  authority:
    "literal-model-graph/native-arrival-union/all-conflicts-quarantined/incremental-model-census-v3",
});
/** Every model page read by an accepted run: the next run reference for read
 * reasons, expected cards, closing floors and replay coverage. */
export const AplusCensusSchema = ModelCensus.schema(AplusPageSchema, 512);
export type AplusCensus = z.infer<typeof AplusCensusSchema>;
const MakeSchema = AplusControlSchema.extend({
  models: z.array(AplusControlSchema).max(128).nullable(),
});
const progress = z
  .object({
    source: z.literal("aplus"),
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
    pages: z.array(AplusPageSchema).max(512),
    arrivals: z.array(AplusPageSchema).max(1),
    closing: z.number().int().min(0).max(1024),
    requests: z.number().int().min(0).max(APLUS_MAX_REQUESTS),
    /** UTC run day fixed before the first request; null only in the initial cursor. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: AplusCensusSchema.nullable(),
  })
  .strict();
export type AplusProgress = z.infer<typeof progress>;
export type AplusClosingControl =
  | { kind: "contact"; url: typeof APLUS_CONTACT }
  | { kind: "directory"; url: typeof APLUS_MAKES }
  | {
      kind: "model";
      url: string;
      make: AplusMake;
      model: AplusControl;
      index: number;
    };

/** Closing re-reads ownership, the make directory and every model read this run
 * whose cards differ from its badge or fall below its expected count
 * (ModelCensus.closingReads), so a short page is confirmed by an identical
 * re-read in the run that reads it. Other per-model changes surface as count
 * changes in the next run's opening menus. */
export function aplusClosingControls(
  state: Pick<
    AplusProgress,
    "makes" | "pages" | "arrivals" | "previous" | "day"
  >,
): AplusClosingControl[] {
  const models = aplusModels(state.makes);
  const decisions =
    state.day === null || state.pages.length !== models.length
      ? []
      : aplusCensusPlan(state);
  const mismatched = decisions.length
    ? ModelCensus.closingReads({
        controls: aplusCensusControls(state.makes),
        pages: state.pages,
        decisions,
        previous: state.previous,
        cards: aplusCards,
      }).flatMap((index) => {
        const value = models[index];
        return value
          ? [
              {
                kind: "model" as const,
                url: APLUS_ORIGIN + value.model.path,
                make: value.make,
                model: value.model,
                index,
              },
            ]
          : [];
      })
    : [];
  return [
    { kind: "contact", url: APLUS_CONTACT },
    { kind: "directory", url: APLUS_MAKES },
    ...mismatched,
  ];
}

function aplusCensusControls(
  makes: readonly AplusMake[],
): ModelCensusControl[] {
  return aplusModels(makes).map(({ make, model }) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    count: model.count,
  }));
}

/** Read every published model on every run (`reuse: "never"`): an unchanged
 * badge can hide a donor swapped under it. A read is labelled `trigger` when an
 * opening arrival names the model but its last accepted page lacks that donor. */
export function aplusCensusPlan(
  state: Pick<AplusProgress, "makes" | "arrivals" | "previous" | "day">,
): ModelCensusDecision<AplusPage>[] {
  if (state.day === null) throw new Error("Aplus census plan needs a run day");
  const controls = aplusCensusControls(state.makes);
  const models = aplusModels(state.makes);
  const carried = new Map(
    (state.previous?.models ?? []).map((m) => [m.key, m.page]),
  );
  const triggers = new Set<string>();
  for (const record of state.arrivals[0]?.records ?? []) {
    const path = record[4].startsWith(APLUS_ORIGIN)
      ? record[4].slice(APLUS_ORIGIN.length)
      : record[4];
    const parent = path.split("/").slice(0, -2).join("/");
    const index = models.findIndex(
      (m) => m.model.path.replace(/\/$/, "") === parent,
    );
    const key = controls[index]?.key;
    if (key && !carried.get(key)?.records.some((r) => r[0] === record[0]))
      triggers.add(key);
  }
  return ModelCensus.plan(controls, state.previous, state.day, {
    cards: aplusCards,
    triggers,
    reuse: "never",
  });
}

const aplusCards = (page: AplusPage) => page.records.length;
/** Published model counts have matched model cards exactly in every observed
 * A Plus census (1,133 of 1,133 on 210 models). */
export const APLUS_MINIMUM_BADGE_COVERAGE = 0.95;

/** Fails a run whose read and carried model cards fall short of today's model
 * counts, before anything is published. */
export function aplusCoverageError(state: AplusProgress): string | null {
  const models = aplusModels(state.makes);
  return ModelCensus.coverage(
    "Aplus",
    {
      controls: aplusCensusControls(state.makes),
      pages: state.pages,
      day: state.day,
      previous: state.previous,
      cards: aplusCards,
    },
    APLUS_MINIMUM_BADGE_COVERAGE,
    (index) => {
      const value = models[index];
      return value ? value.make.label + " " + value.model.label : "?";
    },
  );
}

/** Terminal census for a fully closed run. */
export function aplusCensus(state: AplusProgress): AplusCensus {
  if (state.day === null) throw new Error("Aplus census has no run day");
  return ModelCensus.accept(
    scope,
    state.day,
    {
      controls: aplusCensusControls(state.makes),
      pages: state.pages,
      decisions: aplusCensusPlan(state),
      previous: state.previous,
      cards: aplusCards,
    },
    // Closing re-reads every short page read this run and fails on a change.
    "confirmed",
  );
}

function checksum(state: Omit<AplusProgress, "checksum"> | AplusProgress) {
  return aplusHash({
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

export const AplusCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("aplus"),
        version: z.literal(1),
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: AplusCensusSchema.optional(),
      })
      .strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > APLUS_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error("Aplus cursor size or integrity changed");
      const stages = [
        "contact",
        "root",
        "directory",
        "makes",
        "models",
        "closing",
      ];
      const stage = stages.indexOf(state.phase);
      const models = aplusModels(state.makes);
      const completedMakes = state.makes.filter(
        (m) => m.models !== null,
      ).length;
      if (
        (stage === 0) !== (state.contact === null) ||
        state.arrivals.length !== (stage < 2 ? 0 : 1)
      )
        throw new Error("Aplus owner/root phase evidence is inconsistent");
      if (
        stage < 3 !== (state.makes.length === 0) ||
        completedMakes !==
          (stage < 3 ? 0 : stage === 3 ? completedMakes : state.makes.length) ||
        state.makes.slice(0, completedMakes).some((m) => m.models === null) ||
        state.makes.slice(completedMakes).some((m) => m.models !== null)
      )
        throw new Error(
          "Aplus make directory evidence is not a contiguous published prefix",
        );
      if (
        models.length > 512 ||
        state.pages.length > models.length ||
        (stage < 4 && state.pages.length !== 0) ||
        (stage === 4 && state.pages.length >= models.length) ||
        (stage === 5 && state.pages.length !== models.length) ||
        (stage === 3 && completedMakes >= state.makes.length)
      )
        throw new Error("Aplus model page phase/order is inconsistent");
      if (
        state.day === null
          ? state.requests !== 0 || state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== scope ||
              state.previous.day > state.day)
      )
        throw new Error("Aplus run day or previous census is inconsistent");
      // Carried pages are exactly the previous census evidence and cost no GET.
      let readPages = 0;
      if (stage >= 4) {
        const decisions = aplusCensusPlan(state);
        state.pages.forEach((page, index) => {
          const decision = decisions[index];
          if (decision?.kind === "read") readPages++;
          else if (decision?.evidence.page.hash !== page.hash)
            throw new Error("Aplus carried model page differs from its census");
        });
        if (stage === 4 && decisions[state.pages.length]?.kind !== "read")
          throw new Error("Aplus next model page is not due for a read");
      }
      if (
        (stage < 5 && state.closing !== 0) ||
        (stage === 5 && state.closing > aplusClosingControls(state).length)
      )
        throw new Error("Aplus closing control prefix is inconsistent");
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          state.arrivals.length +
          (state.makes.length ? 1 : 0) +
          completedMakes +
          readPages +
          state.closing
      )
        throw new Error("Aplus request accounting is inconsistent");
      if (
        new Set(state.makes.map((m) => m.path)).size !== state.makes.length ||
        new Set(models.map((m) => m.model.path)).size !== models.length
      )
        throw new Error(
          "Aplus checkpoint repeats a native directory destination",
        );
      for (const make of state.makes) {
        if (aplusBrowsePath(APLUS_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Invalid Aplus make destination");
        for (const model of make.models ?? [])
          if (
            aplusBrowsePath(APLUS_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error("Invalid Aplus model destination binding");
      }
      if (state.pages.reduce((n, p) => n + p.records.length, 0) > 10_000)
        throw new Error("Aplus checkpoint exceeds 10000 raw model rows");
      for (const page of [...state.pages, ...state.arrivals])
        if (page.hash !== aplusHash(page.records))
          throw new Error("Aplus native record fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Aplus native checkpoint",
      });
    }
  });
export type AplusCursor = z.infer<typeof AplusCursorSchema>;
const initial: Omit<AplusProgress, "checksum"> = {
  source: "aplus",
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
export const AplusCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): AplusCursor {
    if (Buffer.byteLength(value) > APLUS_MAX_CURSOR_BYTES)
      throw new Error(
        "Aplus cursor wire payload exceeds 4 MiB; keep the last validated checkpoint",
      );
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      throw new Error(
        "Aplus cursor wire payload is not valid JSON; keep the last validated checkpoint",
      );
    }
    return AplusCursorSchema.parse(candidate);
  },
  serialize(cursor: AplusCursor): string {
    const value = JSON.stringify(AplusCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > APLUS_MAX_CURSOR_BYTES)
      throw new Error(
        "Aplus cursor wire payload exceeds 4 MiB; keep the last validated checkpoint",
      );
    return value;
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: AplusProgress,
    now: number,
    previousCursor: unknown,
  ): { cursor: AplusProgress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = AplusCursorSchema.safeParse(previousCursor ?? undefined);
    const corrupt = (census: AplusCensus | undefined) =>
      census?.models.some((m) => m.page.hash !== aplusHash(m.page.records)) ??
      false;
    const previous =
      parsed.success &&
      parsed.data.phase === "complete" &&
      corrupt(parsed.data.census)
        ? {
            kind: "cold" as const,
            warning:
              "Previous Aplus census page fails its record fingerprint; reading every model page.",
          }
        : parsed.success && parsed.data.phase === "complete"
          ? ModelCensus.previous(parsed.data.census, scope, day)
          : {
              kind: "cold" as const,
              warning:
                previousCursor === null || previousCursor === undefined
                  ? null
                  : "Previous Aplus checkpoint is not a readable terminal census; reading every model page.",
            };
    return {
      cursor: AplusCursor.checkpoint({
        ...cursor,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
  checkpoint(
    state: Omit<AplusProgress, "checksum"> | AplusProgress,
  ): AplusProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = AplusCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Aplus checkpoint");
    return parsed;
  },
} as const satisfies {
  initial: AplusProgress;
  parse: (value: string) => AplusCursor;
  serialize: (cursor: AplusCursor) => string;
  begin: (
    cursor: AplusProgress,
    now: number,
    previousCursor: unknown,
  ) => { cursor: AplusProgress; warning: string | null };
  checkpoint: (
    state: Omit<AplusProgress, "checksum"> | AplusProgress,
  ) => AplusProgress;
};
