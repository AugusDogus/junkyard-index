import { z } from "zod";
import {
  JimsimportControlSchema,
  JimsimportMenuSchema,
  JimsimportPageSchema,
  jimsimportControlPath,
  jimsimportHash,
  type JimsimportControl,
  type JimsimportPage,
  type JimsimportMenu,
} from "./jimsimport-parser";
import {
  jimsimportModels,
  jimsimportSnapshot,
  validateJimsimportSnapshot,
} from "./jimsimport-transform";
import {
  JIMSIMPORT_CATALOG,
  JIMSIMPORT_ORIGIN,
  JIMSIMPORT_YARD,
} from "./jimsimport-yard-metadata";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";

const scope = jimsimportHash({
  version: 1,
  catalog: JIMSIMPORT_CATALOG,
  yard: JIMSIMPORT_YARD,
  floor: 1_216,
  census: "incremental-model-census-v3",
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Every model page of an accepted run: the next run reference for read
 * reasons, expected cards, closing floors and replay coverage. */
export const JimsimportCensusSchema = ModelCensus.schema(
  JimsimportPageSchema,
  1024,
);
export type JimsimportCensus = z.infer<typeof JimsimportCensusSchema>;
const counters = {
  requests: z.number().int().min(0).max(1024),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(128 * 1024 * 1024),
};
const base = {
  source: z.literal("jimsimport"),
  version: z.literal(1),
  scope: z.literal(scope),
  ...counters,
  /** UTC run day fixed before the first request; null only in the initial cursor. */
  day: z.number().int().nonnegative().safe().nullable(),
  /** Compatible census from the last accepted run, or null for a cold census. */
  previous: JimsimportCensusSchema.nullable(),
};
const owner = { ...base, ownerHash: hash };
const makes = {
  ...owner,
  makes: z.array(JimsimportControlSchema).min(1).max(128),
};
const graph = { ...makes, menus: z.array(JimsimportMenuSchema).max(128) };
/** Read and carried model pages in published model order. */
const opening = { ...graph, opening: z.array(JimsimportPageSchema).max(1024) };
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z.object({ ...owner, phase: z.literal("makes") }).strict(),
  z.object({ ...graph, phase: z.literal("models") }).strict(),
  z.object({ ...opening, phase: z.literal("opening") }).strict(),
  z.object({ ...opening, phase: z.literal("closing-makes") }).strict(),
  z
    .object({
      ...opening,
      phase: z.literal("closing-models"),
      /** Closing model controls already confirmed, in control order. */
      closed: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ ...opening, phase: z.literal("owner-closing") }).strict(),
  z
    .object({
      source: z.literal("jimsimport"),
      version: z.literal(1),
      // Pre-incremental terminal cursors (older scope, no census) stay
      // readable but seed a cold census.
      scope: hash,
      ...counters,
      phase: z.literal("complete"),
      census: JimsimportCensusSchema.optional(),
    })
    .strict(),
]);
export type JimsimportState = z.infer<typeof schema>;
export type JimsimportCursor = JimsimportState & { checksum: string };

/** The key binds every control field the page parser and record validator
 * read (parent make path and label, model path and label). Make badges are
 * diagnostic and bound by no page, so they do not force reads. */
function censusControls(
  menus: readonly JimsimportMenu[],
): ModelCensusControl[] {
  return jimsimportModels(menus).map(({ make, model }) => ({
    key: JSON.stringify([make.path, make.label, model.path, model.label]),
    count: model.count,
  }));
}

/** Read every published model on every run (`reuse: "never"`): an unchanged
 * badge can hide a donor swapped under it. Derived only from cursor
 * contents. */
export function jimsimportCensusPlan(state: {
  menus: readonly JimsimportMenu[];
  previous: JimsimportCensus | null;
  day: number | null;
}): ModelCensusDecision<JimsimportPage>[] {
  if (state.day === null)
    throw new Error("Jim's Import census plan needs a run day");
  return ModelCensus.plan(
    censusControls(state.menus),
    state.previous,
    state.day,
    {
      cards: jimsimportCards,
      reuse: "never",
    },
  );
}

/** Cards a model page lists, as closing compares them with the badge. */
const jimsimportCards = (page: JimsimportPage) => page.records.length;
/** Badges are diagnostic, not exact card counts: on the saved Nov 15 census
 * 23 of 334 models disagree, but cards capped at each badge cover 3,980 of
 * 3,981 (99.97%). An empty sweep slice leaves at most 86.7% (3,453 of 3,981
 * on the lightest slice) and one cut to a single card per model at most 88.1%
 * (3,507 of 3,981), so either fails on its first day. */
export const JIMSIMPORT_MINIMUM_BADGE_COVERAGE = 0.95;

/** Fails a complete opening whose read and carried model cards fall short of
 * today's model badges or of the last accepted cards of models whose badge is
 * unchanged, before any snapshot or callback. */
export function jimsimportCoverageError(state: {
  menus: readonly JimsimportMenu[];
  opening: readonly JimsimportPage[];
  previous: JimsimportCensus | null;
  day: number | null;
}): string | null {
  const models = jimsimportModels(state.menus);
  return ModelCensus.coverage(
    "Jim's Import",
    {
      controls: censusControls(state.menus),
      pages: state.opening,
      day: state.day,
      previous: state.previous,
      cards: jimsimportCards,
    },
    JIMSIMPORT_MINIMUM_BADGE_COVERAGE,
    (index) => models[index]?.model.path ?? "?",
  );
}

export interface JimsimportClosingModel {
  url: string;
  make: JimsimportControl;
  model: JimsimportControl;
  index: number;
}

/** Model pages read this run whose cards differ from their badge or fall below
 * their expected count (ModelCensus.closingReads), re-read after the make
 * directory so a short page is confirmed by an identical re-read in the run
 * that reads it. * Other per-model changes surface as count changes in the next
 * run's opening menus. Derived only from cursor contents of a complete opening. */
export function jimsimportClosingModels(state: {
  menus: readonly JimsimportMenu[];
  opening: readonly JimsimportPage[];
  previous: JimsimportCensus | null;
  day: number | null;
}): JimsimportClosingModel[] {
  const models = jimsimportModels(state.menus);
  if (state.opening.length > models.length)
    throw new Error(
      "Jim's Import closing model is outside the published graph",
    );
  return ModelCensus.closingReads({
    controls: censusControls(state.menus),
    pages: state.opening,
    decisions: jimsimportCensusPlan(state),
    previous: state.previous,
    cards: jimsimportCards,
  }).flatMap((index) => {
    const entry = models[index];
    return entry
      ? [{ url: JIMSIMPORT_ORIGIN + entry.model.path, ...entry, index }]
      : [];
  });
}

/** Terminal census for a fully closed run. */
export function jimsimportCensus(state: {
  menus: readonly JimsimportMenu[];
  opening: readonly JimsimportPage[];
  previous: JimsimportCensus | null;
  day: number | null;
}): JimsimportCensus {
  if (state.day === null) throw new Error("Jim's Import census has no run day");
  return ModelCensus.accept(
    scope,
    state.day,
    {
      controls: censusControls(state.menus),
      pages: state.opening,
      decisions: jimsimportCensusPlan(state),
      previous: state.previous,
      cards: jimsimportCards,
    },
    // Closing re-reads every model read this run whose cards differ from its
    // badge or fall below its expected count and fails on any required-donor
    // change.
    "confirmed",
  );
}

function prefix(
  menus: readonly JimsimportMenu[],
  pages: readonly JimsimportPage[],
  complete: boolean,
) {
  const models = jimsimportModels(menus);
  if (
    (complete
      ? pages.length !== models.length
      : pages.length >= models.length) ||
    pages.some(
      (p, i) =>
        p.makePath !== models[i]?.make.path ||
        p.modelPath !== models[i]?.model.path ||
        (p.records.length === 0) !== p.nativeEmpty,
    )
  )
    throw new Error(
      "Jim's Import checkpoint lost its complete ordered native model frontier",
    );
}
function checkpoint(state: JimsimportState): JimsimportCursor {
  const parsed = schema.parse(state);
  if (parsed.phase === "complete")
    return { ...parsed, checksum: jimsimportHash(parsed) };
  if (
    parsed.day === null
      ? parsed.phase !== "owner" ||
        parsed.requests !== 0 ||
        parsed.previous !== null
      : parsed.previous !== null &&
        (parsed.previous.contract !== scope || parsed.previous.day > parsed.day)
  )
    throw new Error(
      "Jim's Import checkpoint run day or previous census is inconsistent",
    );
  if (
    "ownerHash" in parsed &&
    parsed.ownerHash !== jimsimportHash(JIMSIMPORT_YARD)
  )
    throw new Error("Jim's Import checkpoint physical owner changed");
  if (
    "makes" in parsed &&
    (new Set(parsed.makes.map((c) => c.path)).size !== parsed.makes.length ||
      parsed.makes.some((c) => jimsimportControlPath(c.path, 1) !== c.path))
  )
    throw new Error(
      "Jim's Import checkpoint make controls are invalid or repeated",
    );
  if ("menus" in parsed) {
    if (
      (parsed.phase === "models"
        ? parsed.menus.length >= parsed.makes.length
        : parsed.menus.length !== parsed.makes.length) ||
      parsed.menus.some(
        (menu, i) =>
          jimsimportHash(menu.make) !== jimsimportHash(parsed.makes[i]) ||
          !menu.models.length ||
          new Set(menu.models.map((c) => c.path)).size !== menu.models.length ||
          menu.models.some(
            (c) =>
              jimsimportControlPath(c.path, 2) !== c.path ||
              !c.path.startsWith(menu.make.path.replace(/\/$/, "") + "/"),
          ),
      )
    )
      throw new Error(
        "Jim's Import checkpoint model menus lost their published parent frontier",
      );
    if (jimsimportModels(parsed.menus).length > 1024)
      throw new Error("Jim's Import model graph exceeds 1024 leaves");
  }
  let readPages = 0;
  let closingPages = 0;
  if ("opening" in parsed) {
    prefix(parsed.menus, parsed.opening, parsed.phase !== "opening");
    // Carried pages are exactly the previous census evidence; only read
    // decisions cost a native GET. The plan is re-derived, never stored.
    const decisions = jimsimportCensusPlan(parsed);
    parsed.opening.forEach((page, index) => {
      const decision = decisions[index];
      if (decision?.kind === "read") readPages++;
      else if (
        !decision ||
        jimsimportHash(decision.evidence.page) !== jimsimportHash(page)
      )
        throw new Error(
          "Jim's Import carried model page differs from its accepted census evidence",
        );
    });
    if (
      parsed.phase === "opening" &&
      decisions[parsed.opening.length]?.kind !== "read"
    )
      throw new Error("Jim's Import next model page is not due for a read");
    if (parsed.phase === "closing-models" || parsed.phase === "owner-closing") {
      const controls = jimsimportClosingModels(parsed).length;
      if (parsed.phase === "closing-models" && parsed.closed >= controls)
        throw new Error(
          "Jim's Import closing model checkpoint is past its re-read controls",
        );
      closingPages =
        parsed.phase === "owner-closing" ? controls : parsed.closed;
    }
    if (parsed.phase !== "opening")
      validateJimsimportSnapshot(
        jimsimportSnapshot(parsed.menus, parsed.opening),
      );
  }
  // Native GETs the evidence proves: owner, make directory, each make menu,
  // each read model page and each closing re-read (make directory, then
  // confirmed models). Carried pages cost none.
  const proven =
    parsed.phase === "owner"
      ? 0
      : parsed.phase === "makes"
        ? 1
        : 2 +
          parsed.menus.length +
          readPages +
          (parsed.phase === "closing-models" || parsed.phase === "owner-closing"
            ? 1 + closingPages
            : 0);
  if (parsed.requests < proven)
    throw new Error(
      `Jim's Import request accounting is inconsistent: ${parsed.requests} GETs recorded for ${proven} native reads in evidence`,
    );
  return { ...parsed, checksum: jimsimportHash(parsed) };
}
function parse(input: unknown): JimsimportCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024)
    throw new Error("Jim's Import checkpoint exceeds 8 MiB");
  const { checksum, ...rest } = z
    .object({ checksum: hash })
    .passthrough()
    .parse(input);
  const parsed = checkpoint(schema.parse(rest));
  if (checksum !== parsed.checksum)
    throw new Error(
      "Jim's Import checkpoint checksum changed; retain the last validated checkpoint",
    );
  return parsed;
}
export const JimsimportCursor = {
  initial: (): JimsimportCursor =>
    checkpoint({
      source: "jimsimport",
      version: 1,
      scope,
      phase: "owner",
      requests: 0,
      bytes: 0,
      day: null,
      previous: null,
    }),
  checkpoint,
  parse,
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning; a missing
   * previous cursor is a silent cold start. */
  begin(
    cursor: JimsimportCursor,
    now: number,
    previousCursor: unknown,
  ): { cursor: JimsimportCursor; warning: string | null } {
    if (cursor.phase === "complete" || cursor.day !== null)
      return { cursor, warning: null };
    const day = ModelCensus.day(now);
    let terminal: JimsimportCursor | null = null;
    if (previousCursor !== null && previousCursor !== undefined)
      try {
        terminal = parse(previousCursor);
      } catch {
        terminal = null;
      }
    const previous =
      terminal?.phase === "complete"
        ? ModelCensus.previous(terminal.census, scope, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous Jim's Import checkpoint is not a readable terminal census; reading every model page.",
          };
    const { checksum, ...state } = cursor;
    void checksum;
    return {
      cursor: checkpoint({
        ...state,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
} as const;
