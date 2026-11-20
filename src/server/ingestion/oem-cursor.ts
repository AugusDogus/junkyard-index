import { createHash } from "node:crypto";
import { z } from "zod";
import { OEM_ARRIVALS, OEM_MAKES } from "./oem-html";
import {
  OemControlSchema,
  OemPageSchema,
  oemControlUrl,
  type OemControl,
  type OemPage,
} from "./oem-parser";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";

export const OEM_MAX_REQUESTS = 1800;
export const OEM_MAX_BODY_BYTES = 4 * 1024 * 1024;
export const OEM_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
// Room for the previous census plus this run's pages (about 1.8 MiB each today).
export const OEM_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const oemHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Parser, traversal and closing contract for carried model evidence. */
const OEM_CENSUS_CONTRACT =
  "oem/OH40/literal-model-graph/arrival-union/make-directory-closing/incremental-model-census-v4-expected-surplus-replay";
/** Every model page of an accepted run, carried forward by the next one. */
export const OemCensusSchema = ModelCensus.schema(OemPageSchema, 1024);
export type OemCensus = z.infer<typeof OemCensusSchema>;
const menusSchema = z
  .array(
    z
      .object({
        make: OemControlSchema,
        models: z.array(OemControlSchema).min(1).max(256),
      })
      .strict(),
  )
  .max(128);
const graph = {
  arrivals: OemPageSchema,
  makes: z.array(OemControlSchema).min(1).max(128),
  menus: menusSchema,
};
const donors = { ...graph, pages: z.array(OemPageSchema).max(1024) };
/** Arrival donor destinations of an accepted run. */
const arrivalDestinations = z.array(z.string().max(1000)).max(10000);
/** UTC run day fixed before the first request, the compatible census of the
 * last accepted run (null for a cold census) and that run's arrival donor
 * destinations (empty for a cold census). */
const run = {
  day: z.number().int().nonnegative().safe(),
  previous: OemCensusSchema.nullable(),
  previousArrivals: arrivalDestinations,
};
const StateSchema = z.discriminatedUnion("phase", [
  z
    .object({
      phase: z.literal("arrivals"),
      // Null only before the census begins.
      day: run.day.nullable(),
      previous: run.previous,
      previousArrivals: run.previousArrivals,
    })
    .strict(),
  z
    .object({ phase: z.literal("directory"), ...run, arrivals: OemPageSchema })
    .strict(),
  z.object({ phase: z.literal("menus"), ...run, ...graph }).strict(),
  z.object({ phase: z.literal("models"), ...run, ...donors }).strict(),
  z
    .object({
      phase: z.literal("closing"),
      ...run,
      ...donors,
      closing: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      phase: z.literal("complete"),
      // Pre-incremental terminal cursors stay readable but seed a cold census.
      census: OemCensusSchema.optional(),
      // Present exactly when `census` is.
      arrivals: arrivalDestinations.optional(),
    })
    .strict(),
]);
export type OemState = z.infer<typeof StateSchema>;
export type OemCensusState = Extract<OemState, { phase: "closing" }>;
export const oemModels = (menus: z.infer<typeof menusSchema>) =>
  menus.flatMap(({ make, models }) => models.map((model) => ({ make, model })));
export type OemClosingControl =
  | { kind: "makes"; url: string }
  | {
      kind: "model";
      url: string;
      make: OemControl;
      model: OemControl;
      index: number;
    };
/** Closing re-reads the make directory (every page already proves OH40
 * ownership) and every model read this run whose cards differ from its badge or
 * fall below its expected count (ModelCensus.closingReads), so a short page is
 * confirmed before it can be carried. Carried pages were confirmed on the run
 * that read them; other per-model changes surface as badge changes in the next
 * run's opening menus. */
export function oemClosingControls(
  state: Pick<
    OemCensusState,
    "menus" | "pages" | "day" | "previous" | "previousArrivals" | "arrivals"
  >,
): OemClosingControl[] {
  const models = oemModels(state.menus);
  return [
    { kind: "makes", url: OEM_MAKES },
    ...ModelCensus.closingReads({
      controls: oemCensusControls(state.menus),
      pages: state.pages,
      decisions: oemCensusPlan(state),
      previous: state.previous,
      cards: oemCards,
    }).flatMap((index) => {
      const entry = models[index];
      return entry
        ? [
            {
              kind: "model" as const,
              url: oemControlUrl(entry.model, 3),
              ...entry,
              index,
            },
          ]
        : [];
    }),
  ];
}
function oemCensusControls(
  menus: z.infer<typeof menusSchema>,
): ModelCensusControl[] {
  // Binds every field a model page binds: parent make route/label and model
  // route/label; the model badge is the census count.
  return oemModels(menus).map(({ make, model }) => ({
    key: JSON.stringify([make.url, make.label, model.url, model.label]),
    count: model.count,
  }));
}
/** Read or carry each published model. A current arrival never triggers a
 * read: OEM model pages lag arrivals by days, so that trigger would re-read the
 * same lagging page daily, and arrival donors are published from the arrivals
 * page itself. A donor that leaves the arrivals page is published only through
 * its model page, so a model is read once on the day an arrival donor whose own
 * destination binds to it departs while missing from its carried page. A
 * departing donor whose destination binds to no published model (for example a
 * RAM DODGE title under /parts/RAM/) cannot trigger a read. */
export function oemCensusPlan(
  state: Pick<
    OemCensusState,
    "menus" | "day" | "previous" | "previousArrivals" | "arrivals"
  >,
): ModelCensusDecision<OemPage>[] {
  const controls = oemCensusControls(state.menus);
  const current = new Set(
    state.arrivals.records.flatMap((record) => record.destinations),
  );
  const departed = state.previousArrivals.filter((d) => !current.has(d));
  const triggers = new Set<string>();
  if (!departed.length)
    return ModelCensus.plan(controls, state.previous, state.day, {
      cards: oemCards,
      triggers,
    });
  // Directory parsing stores each model control under its resolved owned URL.
  const parents = new Map(
    oemModels(state.menus).map(({ model }, index) => [
      model.url.replace(/\/$/, ""),
      controls[index]?.key,
    ]),
  );
  const carried = new Map(
    (state.previous?.models ?? []).map((m) => [m.key, m.page]),
  );
  for (const destination of departed) {
    // Destinations are /parts/MAKE/MODEL/STOCK/YEAR under the owned origin.
    const key = parents.get(destination.split("/").slice(0, -2).join("/"));
    if (
      key &&
      !carried
        .get(key)
        ?.records.some((record) => record.destinations.includes(destination))
    )
      triggers.add(key);
  }
  return ModelCensus.plan(controls, state.previous, state.day, {
    cards: oemCards,
    triggers,
  });
}
/** Cards a model page lists, as closing compares them with its badge. */
const oemCards = (page: OemPage) => page.records.length;
/** Model badges overstate cards because model pages lag arrivals and some
 * models render an explicit empty under a nonzero badge. The November 15
 * census listed 2,167 cards under 2,428 badges (89.25%, each model capped at
 * its badge). Emptying any one of its six sweep slices drops that to 70.5% to
 * 79.0%, so 82% leaves about 7 points for extra lag and still fails the first
 * run whose swept pages break. Cutting a slice to one card per model leaves
 * 73.0% to 80.6% of badges, close to this floor; on incremental runs the replay
 * floor (ModelCensus.coverage) catches that cut at 81.8% to 90.3% of the last
 * accepted cards. */
export const OEM_MINIMUM_BADGE_COVERAGE = 0.82;
/** Fails a run whose read and carried model cards fall short of today's model
 * badges, before anything is published. */
export function oemCoverageError(
  state: Pick<OemCensusState, "menus" | "pages" | "previous">,
): string | null {
  const models = oemModels(state.menus);
  return ModelCensus.coverage(
    "OEM",
    {
      controls: oemCensusControls(state.menus),
      pages: state.pages,
      previous: state.previous,
      cards: oemCards,
    },
    OEM_MINIMUM_BADGE_COVERAGE,
    (index) => {
      const entry = models[index];
      return entry ? entry.make.label + " / " + entry.model.label : "?";
    },
  );
}
/** Terminal census for a fully closed run. */
export function oemCensus(state: OemCensusState): OemCensus {
  return ModelCensus.accept(
    OEM_CENSUS_CONTRACT,
    state.day,
    {
      controls: oemCensusControls(state.menus),
      pages: state.pages,
      decisions: oemCensusPlan(state),
      previous: state.previous,
      cards: oemCards,
    },
    // Closing re-reads every short page read this run and fails on a change.
    "confirmed",
  );
}
const cursor = z
  .object({
    source: z.literal("oem"),
    version: z.literal(1),
    requests: z.number().int().nonnegative().max(OEM_MAX_REQUESTS),
    bytes: z.number().int().nonnegative().max(OEM_MAX_TOTAL_BYTES),
    state: StateSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type OemCursor = z.infer<typeof cursor>;
const checksum = (value: Omit<OemCursor, "checksum">) =>
  oemHash({
    source: value.source,
    version: value.version,
    requests: value.requests,
    bytes: value.bytes,
    state: value.state,
  });
function inspect(value: OemCursor): void {
  if (
    Buffer.byteLength(JSON.stringify(value)) > OEM_MAX_CURSOR_BYTES ||
    value.checksum !== checksum(value)
  )
    throw new Error("OEM checkpoint exceeds 8 MiB or its integrity changed");
  const state = value.state;
  if (state.phase === "complete") {
    if ((state.census === undefined) !== (state.arrivals === undefined))
      throw new Error(
        "OEM terminal census and its arrival destinations must be stored together",
      );
    return;
  }
  if (
    (state.previous === null && state.previousArrivals.length > 0) ||
    (state.day === null
      ? value.requests !== 0 || state.previous !== null
      : state.previous !== null &&
        (state.previous.contract !== OEM_CENSUS_CONTRACT ||
          state.previous.day > state.day))
  )
    throw new Error("OEM run day or previous model census is inconsistent");
  let expected = 0;
  if (state.phase !== "arrivals") {
    expected++;
    if (
      state.arrivals.sourceUrl !== OEM_ARRIVALS ||
      state.arrivals.records.some(
        (r, i) =>
          r.sourceUrl !== OEM_ARRIVALS ||
          r.context.kind !== "arrivals" ||
          r.ordinal !== i,
      )
    )
      throw new Error(
        "OEM arrivals checkpoint lost its source/ordinal binding",
      );
  }
  if (
    state.phase === "menus" ||
    state.phase === "models" ||
    state.phase === "closing"
  ) {
    expected += 1 + state.menus.length;
    if (
      state.menus.length > state.makes.length ||
      (state.phase === "menus" && state.menus.length >= state.makes.length) ||
      (state.phase !== "menus" && state.menus.length !== state.makes.length) ||
      new Set(state.makes.map((m) => oemControlUrl(m, 2))).size !==
        state.makes.length
    )
      throw new Error(
        "OEM make checkpoint is not a contiguous native graph prefix",
      );
    state.menus.forEach((menu, index) => {
      if (oemHash(menu.make) !== oemHash(state.makes[index]))
        throw new Error("OEM model menu lost its native make binding");
      for (const model of menu.models)
        if (
          !oemControlUrl(model, 3).startsWith(
            oemControlUrl(menu.make, 2).replace(/\/$/, "") + "/",
          )
        )
          throw new Error("OEM model checkpoint gained a foreign parent");
    });
    const models = oemModels(state.menus);
    if (
      models.length > 1024 ||
      new Set(models.map((m) => m.model.url)).size !== models.length
    )
      throw new Error("OEM model graph is oversized or repeats a control");
    if (state.phase !== "menus") {
      if (
        state.pages.length > models.length ||
        (state.phase === "models" && state.pages.length >= models.length) ||
        (state.phase === "closing" && state.pages.length !== models.length)
      )
        throw new Error(
          "OEM donor checkpoint is not a contiguous native model prefix",
        );
      state.pages.forEach((page, index) => {
        const entry = models[index];
        if (
          !entry ||
          page.sourceUrl !== oemControlUrl(entry.model, 3) ||
          page.records.some(
            (r, i) =>
              r.ordinal !== i ||
              r.sourceUrl !== page.sourceUrl ||
              r.context.kind !== "model" ||
              oemHash(r.context.make) !==
                oemHash({ url: entry.make.url, label: entry.make.label }) ||
              oemHash(r.context.model) !== oemHash(entry.model),
          )
        )
          throw new Error(
            "OEM donor checkpoint lost a model/source/ordinal binding",
          );
      });
      // Re-derive the plan: carried pages are exactly the previous census
      // evidence and cost no GET; the next page must be due for a read.
      const decisions = oemCensusPlan(state);
      state.pages.forEach((page, index) => {
        const decision = decisions[index];
        if (decision?.kind === "read") expected++;
        else if (!decision || oemHash(decision.evidence.page) !== oemHash(page))
          throw new Error(
            "OEM carried model page differs from its accepted census evidence",
          );
      });
      if (
        state.phase === "models" &&
        decisions[state.pages.length]?.kind !== "read"
      )
        throw new Error("OEM next model page is not due for a native read");
      if (
        state.arrivals.records.length +
          state.pages.reduce((n, p) => n + p.records.length, 0) >
        20000
      )
        throw new Error("OEM checkpoint exceeds the observed donor capacity");
      if (state.phase === "closing") {
        if (state.closing > oemClosingControls(state).length)
          throw new Error("OEM closing prefix exceeds its native controls");
        expected += state.closing;
      }
    }
  }
  if (
    value.requests !== expected ||
    (expected === 0 ? value.bytes !== 0 : value.bytes < expected)
  )
    throw new Error(
      "OEM checkpoint request/body accounting does not reconcile",
    );
}
export const OemCursorSchema = cursor.superRefine((value, context) => {
  try {
    inspect(value);
  } catch (cause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        cause instanceof Error ? cause.message : "Invalid OEM checkpoint",
    });
  }
});
function checkpoint(value: Omit<OemCursor, "checksum">): OemCursor {
  // Zod orders nested fields by schema. Hash that parsed representation so
  // serialization/resumption cannot change an otherwise identical checkpoint.
  const parsed = cursor.omit({ checksum: true }).parse({
    source: value.source,
    version: value.version,
    requests: value.requests,
    bytes: value.bytes,
    state: value.state,
  });
  return OemCursorSchema.parse({ ...parsed, checksum: checksum(parsed) });
}
/** Fixes the run day and adopts the last accepted census before the first
 * request. Anything unusable starts a cold census with a warning; a missing
 * previous cursor is a silent cold start. */
function begin(
  value: OemCursor,
  now: number,
  previousCursor: unknown,
): { cursor: OemCursor; warning: string | null } {
  const state = value.state;
  if (state.phase !== "arrivals" || state.day !== null)
    return { cursor: value, warning: null };
  const day = ModelCensus.day(now);
  // The durable wire format omits `source` (the checksum still covers it), so
  // restore it the way the durable parser does before validating.
  const parsed = OemCursorSchema.safeParse(
    typeof previousCursor === "object" &&
      previousCursor !== null &&
      !Array.isArray(previousCursor)
      ? { ...previousCursor, source: "oem" }
      : (previousCursor ?? undefined),
  );
  const terminal =
    parsed.success && parsed.data.state.phase === "complete"
      ? parsed.data.state
      : null;
  const previous =
    terminal !== null
      ? ModelCensus.previous(terminal.census, OEM_CENSUS_CONTRACT, day)
      : {
          kind: "cold" as const,
          warning:
            previousCursor === null || previousCursor === undefined
              ? null
              : "Previous OEM checkpoint is not a readable terminal census; reading every model page.",
        };
  return {
    cursor: checkpoint({
      ...value,
      state: {
        phase: "arrivals",
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
        previousArrivals:
          previous.kind === "incremental" ? (terminal?.arrivals ?? []) : [],
      },
    }),
    warning: previous.kind === "cold" ? previous.warning : null,
  };
}
export const OemCursor = {
  schema: OemCursorSchema,
  initial: () =>
    checkpoint({
      source: "oem",
      version: 1,
      requests: 0,
      bytes: 0,
      state: {
        phase: "arrivals",
        day: null,
        previous: null,
        previousArrivals: [],
      },
    }),
  checkpoint,
  begin,
} as const;
