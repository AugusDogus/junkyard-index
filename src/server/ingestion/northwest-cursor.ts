import { z } from "zod";
import {
  northwestHash,
  NorthwestControlSchema,
  NorthwestPageSchema,
  type NorthwestPage,
} from "./northwest-parser";
import { NorthwestRecordSchema } from "./northwest-record";
import { northwestModels, type NorthwestMake } from "./northwest-catalog";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";
import {
  NORTHWEST_ROOT,
  NORTHWEST_MAKES,
  NORTHWEST_ORIGIN,
  NORTHWEST_YARD,
  northwestBrowsePath,
} from "./northwest-yard-metadata";

// Room for the previous census plus this run's pages (about 4 MiB each today).
export const NORTHWEST_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
export const NORTHWEST_MAX_REQUESTS = 1600;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = northwestHash({
  version: 1,
  yard: NORTHWEST_YARD,
  contract:
    "AK01/legacy-model-graph/all-identity-conflicts-quarantined/one-percent-unrecovered/incremental-model-census-v1",
});
// Census pages are written from parsed pages, so every defaulted record field
// is present; requiring them keeps the census page type equal to NorthwestPage.
const strings = z.array(z.string());
const CensusPageSchema = NorthwestPageSchema.extend({
  records: z
    .array(
      NorthwestRecordSchema.extend({
        inquiries: strings,
        stockNumbers: strings,
        imageUrls: strings,
        availableDates: strings,
        colors: strings,
        sections: strings,
        rows: strings,
        spaces: strings,
      }),
    )
    .max(1000),
});
/** Every model page read by an accepted run, carried forward by the next one. */
export const NorthwestCensusSchema = ModelCensus.schema(CensusPageSchema, 1024);
export type NorthwestCensus = z.infer<typeof NorthwestCensusSchema>;
const progress = z
  .object({
    source: z.literal("northwest"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["root", "directory", "makes", "models", "closing"]),
    root: hash.nullable(),
    makes: z
      .array(
        NorthwestControlSchema.extend({
          models: z.array(NorthwestControlSchema).max(128).nullable(),
        }),
      )
      .max(64),
    pages: z.array(NorthwestPageSchema).max(1024),
    closing: z.number().int().min(0).max(1100),
    requests: z.number().int().min(0).max(NORTHWEST_MAX_REQUESTS),
    /** UTC run day fixed before the first request; null only in the initial cursor. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: NorthwestCensusSchema.nullable(),
  })
  .strict();
export type NorthwestProgress = z.infer<typeof progress>;
export type NorthwestClosingControl =
  | { kind: "root"; url: typeof NORTHWEST_ROOT }
  | { kind: "directory"; url: typeof NORTHWEST_MAKES };

/** Closing re-reads ownership and the make directory only. Make menu and model
 * changes during the run surface as model badge changes in the next run's
 * opening menus, which are all read. */
export function northwestClosingControls(): NorthwestClosingControl[] {
  return [
    { kind: "root", url: NORTHWEST_ROOT },
    { kind: "directory", url: NORTHWEST_MAKES },
  ];
}

// The model parser binds make and model paths and labels into every card.
function northwestCensusControls(
  makes: readonly NorthwestMake[],
): ModelCensusControl[] {
  return northwestModels(makes).map(({ make, model }) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    count: model.count,
  }));
}

/** Read or carry each published model. Latest arrivals are not read (the
 * native list is stale and misses new donors), so nothing triggers a read. */
export function northwestCensusPlan(
  state: Pick<NorthwestProgress, "makes" | "previous" | "day">,
): ModelCensusDecision<NorthwestPage>[] {
  if (state.day === null)
    throw new Error("Northwest census plan needs a run day");
  return ModelCensus.plan(
    northwestCensusControls(state.makes),
    state.previous,
    state.day,
  );
}

/** Terminal census for a fully closed run. */
export function northwestCensus(state: NorthwestProgress): NorthwestCensus {
  if (state.day === null) throw new Error("Northwest census has no run day");
  return ModelCensus.accept(
    scope,
    state.day,
    northwestCensusControls(state.makes),
    state.pages,
    northwestCensusPlan(state),
  );
}

function checksum(
  state: Omit<NorthwestProgress, "checksum"> | NorthwestProgress,
) {
  return northwestHash({
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

export const NorthwestCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("northwest"),
        version: z.literal(1),
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: NorthwestCensusSchema.optional(),
      })
      .strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > NORTHWEST_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "Northwest checkpoint exceeds 16 MiB or its integrity changed",
        );
      const stage = ["root", "directory", "makes", "models", "closing"].indexOf(
        state.phase,
      );
      const completed = state.makes.filter(
        (make) => make.models !== null,
      ).length;
      const models = northwestModels(state.makes);
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
          "Northwest checkpoint is not a contiguous native root/make prefix",
        );
      if (
        models.length > 1024 ||
        state.pages.length > models.length ||
        (stage < 3 && state.pages.length !== 0) ||
        (stage === 3 && state.pages.length >= models.length) ||
        (stage === 4 && state.pages.length !== models.length) ||
        (stage < 4 && state.closing !== 0) ||
        (stage === 4 && state.closing > northwestClosingControls().length)
      )
        throw new Error(
          "Northwest model or closing checkpoint prefix is inconsistent",
        );
      if (
        state.day === null
          ? state.requests !== 0 || state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== scope ||
              state.previous.day > state.day)
      )
        throw new Error(
          "Northwest run day or previous model census is inconsistent",
        );
      // Carried pages are exactly the previous census evidence and cost no GET.
      let readPages = 0;
      if (stage >= 3) {
        const decisions = northwestCensusPlan(state);
        state.pages.forEach((page, index) => {
          const decision = decisions[index];
          if (decision?.kind === "read") readPages++;
          else if (decision?.evidence.page.hash !== page.hash)
            throw new Error(
              "Northwest carried model page differs from its census",
            );
        });
        if (stage === 3 && decisions[state.pages.length]?.kind !== "read")
          throw new Error("Northwest next model page is not due for a read");
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
          "Northwest checkpoint request accounting is inconsistent",
        );
      if (
        new Set(state.makes.map((make) => make.path)).size !==
          state.makes.length ||
        new Set(models.map((entry) => entry.model.path)).size !== models.length
      )
        throw new Error(
          "Northwest checkpoint repeats a published directory destination",
        );
      for (const make of state.makes) {
        if (northwestBrowsePath(NORTHWEST_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Northwest make destination changed");
        for (const model of make.models ?? [])
          if (
            northwestBrowsePath(NORTHWEST_ORIGIN + model.path, 2) !==
              model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error(
              "Northwest model destination lost its native make binding",
            );
      }
      if (
        state.pages.reduce((count, page) => count + page.records.length, 0) >
        20_000
      )
        throw new Error("Northwest checkpoint exceeds 20000 raw native cards");
      for (const [index, page] of state.pages.entries()) {
        if (page.hash !== northwestHash(page.records))
          throw new Error("Northwest native card fingerprint changed");
        const control = models[index];
        if (
          !control ||
          page.records.some(
            (record) =>
              record.sourceUrl !== NORTHWEST_ORIGIN + control.model.path ||
              record.context.make.path !== control.make.path ||
              record.context.make.label !== control.make.label ||
              record.context.model.path !== control.model.path ||
              record.context.model.label !== control.model.label,
          )
        )
          throw new Error("Northwest checkpoint donor context changed");
      }
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Northwest checkpoint",
      });
    }
  });
export type NorthwestCursor = z.infer<typeof NorthwestCursorSchema>;
const initial: Omit<NorthwestProgress, "checksum"> = {
  source: "northwest",
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
export const NorthwestCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): NorthwestCursor {
    if (Buffer.byteLength(value) > NORTHWEST_MAX_CURSOR_BYTES)
      throw new Error(
        "Northwest cursor exceeds 16 MiB; retain the last validated checkpoint",
      );
    const candidate: unknown = JSON.parse(value);
    return NorthwestCursorSchema.parse(candidate);
  },
  serialize(cursor: NorthwestCursor): string {
    const value = JSON.stringify(NorthwestCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > NORTHWEST_MAX_CURSOR_BYTES)
      throw new Error(
        "Northwest cursor exceeds 16 MiB; retain the last validated checkpoint",
      );
    return value;
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: NorthwestProgress,
    now: number,
    previousCursor: unknown,
  ): { cursor: NorthwestProgress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = NorthwestCursorSchema.safeParse(previousCursor ?? undefined);
    const previous =
      parsed.success && parsed.data.phase === "complete"
        ? ModelCensus.previous(parsed.data.census, scope, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous Northwest checkpoint is not a readable terminal census; reading every model page.",
          };
    return {
      cursor: NorthwestCursor.checkpoint({
        ...cursor,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
  checkpoint(
    state: Omit<NorthwestProgress, "checksum"> | NorthwestProgress,
  ): NorthwestProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = NorthwestCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Northwest checkpoint");
    return parsed;
  },
} as const;
