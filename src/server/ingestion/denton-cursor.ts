import { z } from "zod";
import {
  DENTON_MAX_BODY_BYTES,
  DentonResponseSchema,
  dentonSlashRedirect,
  type DentonResponse,
} from "./denton-client";
import {
  dentonBoundary,
  dentonOwnedUrl,
  type DentonResult,
} from "./denton-html";
import {
  DENTON_CLOSING_TASKS,
  DENTON_MAX_MODELS,
  DentonEntrySchema,
  DentonModelEntrySchema,
  DentonRedirectSchema,
  dentonFingerprint,
  dentonHash,
  dentonOpened,
  dentonParseEntry,
  dentonTasks,
  dentonValidateEntry,
  type DentonEntry,
  type DentonModelEntry,
  type DentonTask,
} from "./denton-traversal";
import {
  DENTON_PRESERVED_DESTINATION_FAILURES,
  DENTON_YARD,
} from "./denton-yard-metadata";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";

export const DENTON_MINIMUM_INVENTORY = 765;
/** Read plus carried model cards must cover this share of today's opening
 * model badges. Qualification cards covered 99.5% (2,366 of 2,377, including
 * the unreachable TOWN & COUNTRY page). Arrivals count on neither side. */
export const DENTON_MINIMUM_BADGE_COVERAGE = 0.95;
export const DENTON_MAX_REQUESTS = 2048;
export const DENTON_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
// A saved full census cursor was about 2 MB (two 1 MB passes). An in-run
// cursor now holds one pass plus the previous census, so 16 MiB keeps room.
export const DENTON_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
const prior = z.number().int().nonnegative().safe().nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const CONTRACT =
  "literal-controls/slash-menus/owner-directory-closing/arrival-union/native-alias/incremental-model-census-v1";
/** Parser and traversal contract that carried model evidence depends on. It
 * excludes the prior inventory guard, which changes every accepted run. */
const censusContract = dentonHash({ contract: CONTRACT, yard: DENTON_YARD });
/** Every model page held by an accepted run, carried forward by the next one. */
export const DentonCensusSchema = ModelCensus.schema(
  DentonModelEntrySchema,
  DENTON_MAX_MODELS,
);
export type DentonCensus = z.infer<typeof DentonCensusSchema>;
export type DentonCensusDecision = ModelCensusDecision<DentonModelEntry>;
const progress = z
  .object({
    source: z.literal("denton"),
    version: z.literal(1),
    scope: hash,
    checksum: hash,
    phase: z.literal("active"),
    opening: z.array(DentonEntrySchema).max(1024),
    closing: z
      .array(DentonEntrySchema)
      .max(DENTON_CLOSING_TASKS + DENTON_MAX_MODELS),
    pending: DentonRedirectSchema.nullable(),
    requests: z.number().int().min(0).max(DENTON_MAX_REQUESTS),
    bytes: z.number().int().min(0).max(DENTON_MAX_TOTAL_BYTES),
    /** UTC run day fixed before the first request; null only before begin. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: DentonCensusSchema.nullable(),
  })
  .strict();
const terminal = z
  .object({
    source: z.literal("denton"),
    version: z.literal(1),
    checksum: hash,
    phase: z.literal("complete"),
    // Optional so a terminal without a census stays readable and seeds a cold one.
    census: DentonCensusSchema.optional(),
  })
  .strict();
const schema = z.discriminatedUnion("phase", [progress, terminal]);
export type DentonProgress = z.infer<typeof progress>;
export type DentonTerminal = z.infer<typeof terminal>;
export type DentonCursor = z.infer<typeof schema>;
const scope = (previousAcceptedCount: number | null) =>
  dentonHash({
    contract: CONTRACT,
    yard: DENTON_YARD,
    failures: DENTON_PRESERVED_DESTINATION_FAILURES,
    minimumUniqueInventory: DENTON_MINIMUM_INVENTORY,
    maximumRejectionRatio: 0.1,
    maximumDuplicateRatio: 0.25,
    minimumPreviousRunRatio: 0.5,
    minimumBadgeCoverage: DENTON_MINIMUM_BADGE_COVERAGE,
    previousAcceptedCount: prior.parse(previousAcceptedCount),
  });
const checksum = (state: DentonCursor) =>
  dentonHash({ ...state, checksum: undefined });
export function dentonReady(state: DentonProgress) {
  return (
    state.pending === null &&
    dentonOpened(state.opening) &&
    state.closing.length === dentonClosingControls(state).length
  );
}
export function dentonNextTask(state: DentonProgress) {
  const tasks = dentonTasks(state.opening);
  return state.opening.length < tasks.length
    ? tasks[state.opening.length]
    : dentonClosingControls(state)[state.closing.length]?.task;
}

type ModelTask = Extract<DentonTask, { kind: "model" }>;
const modelTasks = (tasks: readonly DentonTask[]) =>
  tasks.filter((task): task is ModelTask => task.kind === "model");
const parentPath = (url: string) => new URL(url).pathname.replace(/\/$/, "");
/** Binds every published field the model page parser and snapshot bind to:
 * make destination and label, model destination and label. */
const censusControls = (models: readonly ModelTask[]): ModelCensusControl[] =>
  models.map(({ make, model }) => ({
    key: JSON.stringify([make.url, make.label, model.url, model.label]),
    count: model.count,
  }));
const donorDestinations = (destinations: readonly (string | null)[]) =>
  destinations.flatMap((literal) => {
    const url = literal === null ? null : dentonOwnedUrl(literal);
    return url &&
      /^\/used-parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname)
      ? [url]
      : [];
  });

/** Read or carry each published model. A carried model is also read when the
 * opening arrivals list a donor whose own destination sits under that model but
 * its carried page lacks that destination. Re-derived from cursor contents. */
export function dentonCensusPlan(
  state: Pick<DentonProgress, "opening" | "day" | "previous">,
): DentonCensusDecision[] {
  if (state.day === null) throw new Error("Census plan needs a run day");
  const tasks = dentonTasks(state.opening);
  const arrivals = state.opening[tasks.findIndex((t) => t.kind === "arrivals")];
  if (arrivals?.kind !== "arrivals")
    throw new Error("Census plan needs the opening arrivals page");
  const models = modelTasks(tasks);
  const controls = censusControls(models);
  const carried = new Map(
    (state.previous?.models ?? []).map((m) => [m.key, m.page]),
  );
  const triggers = new Set<string>();
  for (const record of arrivals.page.records)
    for (const destination of donorDestinations(record.destinations)) {
      const parent = destination.pathname.split("/").slice(0, 4).join("/");
      const key =
        controls[models.findIndex((m) => parentPath(m.model.url) === parent)]
          ?.key;
      if (
        key &&
        !carried
          .get(key)
          ?.page.records.some((r) =>
            donorDestinations(r.destinations).some(
              (url) => url.href === destination.href,
            ),
          )
      )
        triggers.add(key);
    }
  return ModelCensus.plan(controls, state.previous, state.day, triggers);
}
/** A closing re-read and the opening entry it must repeat. */
export interface DentonClosingControl {
  task: DentonTask;
  index: number;
}
/** Closing re-reads ownership, the make directory and every model read this
 * run whose cards differ from its badge, so a short page is confirmed before it
 * can be carried. Carried pages were confirmed on the run that read them; other
 * per-model changes surface as badge changes in the next run's opening.
 * Re-derived from cursor contents. */
export function dentonClosingControls(
  state: Pick<DentonProgress, "opening" | "day" | "previous">,
): DentonClosingControl[] {
  if (!dentonOpened(state.opening))
    throw new Error("Closing controls need the complete opening");
  const tasks = dentonTasks(state.opening);
  const plan = dentonCensusPlan(state);
  let model = 0;
  return tasks.flatMap((task, index) => {
    if (index < DENTON_CLOSING_TASKS) return [{ task, index }];
    if (task.kind !== "model") return [];
    const decision = plan[model++];
    const entry = state.opening[index];
    return decision?.kind === "read" &&
      entry?.kind === "model" &&
      entry.page.records.length !== task.model.count
      ? [{ task, index }]
      : [];
  });
}
const modelEntries = (opening: readonly DentonEntry[]) =>
  opening.filter((entry): entry is DentonModelEntry => entry.kind === "model");

/** Carried pages keep the floor and prior-count guards satisfied while model
 * pages break, so the union of read and carried model cards must reconcile
 * with today's opening model badges before anything is staged. */
export function dentonBadgeCoverage(state: DentonProgress) {
  return dentonBoundary("model badge reconciliation", () => {
    if (!dentonReady(state))
      throw new Error("Opening/details/closing proof is incomplete");
    const models = modelTasks(dentonTasks(state.opening));
    const pages = modelEntries(state.opening);
    if (pages.length !== models.length)
      throw new Error("Model pages do not match the published model controls");
    const badges = models.reduce((n, task) => n + task.model.count, 0);
    const cards = pages.reduce((n, entry) => n + entry.page.records.length, 0);
    if (cards >= Math.ceil(badges * DENTON_MINIMUM_BADGE_COVERAGE)) return;
    const short = models
      .map((task, index) => ({
        model: `${task.make.label} ${task.model.label}`,
        missing: task.model.count - (pages[index]?.page.records.length ?? 0),
      }))
      .filter(({ missing }) => missing > 0)
      .sort((a, b) => b.missing - a.missing)
      .slice(0, 5)
      .map(({ model, missing }) => `${model} (${missing})`);
    throw new Error(
      `Read and carried model pages hold ${cards} cards for ${badges} opening model badges, below the ${DENTON_MINIMUM_BADGE_COVERAGE * 100}% coverage floor. Nothing was staged and the last accepted census stays in place. Largest shortfalls: ${short.join(", ")}; check whether those native model pages render their cards.`,
    );
  });
}

export function dentonNextUrl(state: DentonCursor): DentonResult<string> {
  return dentonBoundary("next request", () => {
    if (state.phase === "complete" || dentonReady(state))
      throw new Error("Terminal traversal has no further requests");
    const task = dentonNextTask(state);
    if (!task)
      throw new Error("Incomplete traversal lost its next published control");
    return state.pending?.target ?? task.url;
  });
}
function validate(
  input: unknown,
  previousAcceptedCount: number | null,
): DentonCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > DENTON_MAX_CURSOR_BYTES)
    throw new Error("Checkpoint exceeds the 16 MiB native corpus bound");
  const parsed = schema.parse(input);
  if (parsed.phase === "complete") {
    if (parsed.checksum !== checksum(parsed))
      throw new Error("Terminal checkpoint integrity changed");
    return parsed;
  }
  const state = parsed;
  if (
    state.scope !== scope(previousAcceptedCount) ||
    state.checksum !== checksum(state)
  )
    throw new Error(
      "Checkpoint scope, prior inventory guard or integrity changed",
    );
  if (
    state.day === null
      ? state.requests !== 0 || state.previous !== null
      : state.previous !== null &&
        (state.previous.contract !== censusContract ||
          state.previous.day > state.day)
  )
    throw new Error(
      "Checkpoint run day or previous model census is inconsistent",
    );
  let requests = 0,
    bytes = 0;
  // Replay the structural prefix so a later make/model cannot fill an earlier
  // gap. Carried model pages must equal the accepted census and cost no GET.
  const prefix: DentonEntry[] = [];
  let plan: DentonCensusDecision[] | null = null;
  let models = 0;
  for (const entry of state.opening) {
    const task = dentonTasks(prefix)[prefix.length];
    if (!task)
      throw new Error("Opening checkpoint exceeds its actual published graph");
    dentonValidateEntry(entry, task);
    if (task.kind === "model") {
      plan ??= dentonCensusPlan({ ...state, opening: prefix });
      const decision = plan[models++];
      if (!decision) throw new Error("Model page is outside the census plan");
      if (decision.kind === "read") account(entry.receipt, task.url);
      else if (dentonHash(entry) !== dentonHash(decision.evidence.page))
        throw new Error(
          "Carried model page differs from its accepted census evidence",
        );
    } else account(entry.receipt, task.url);
    prefix.push(entry);
  }
  const tasks = dentonTasks(state.opening);
  if (
    tasks[state.opening.length]?.kind === "model" &&
    (plan ?? dentonCensusPlan(state))[models]?.kind !== "read"
  )
    throw new Error(
      "Next model page is not due for a read; carried pages must already be checkpointed",
    );
  if (state.closing.length && !dentonOpened(state.opening))
    throw new Error("Closing checkpoint precedes complete opening details");
  const closing = state.closing.length ? dentonClosingControls(state) : [];
  state.closing.forEach((entry, position) => {
    const control = closing[position];
    const original = control && state.opening[control.index];
    if (!control || !original)
      throw new Error(
        "Closing checkpoint exceeds its ownership, directory and short model controls",
      );
    const { task } = control;
    dentonValidateEntry(entry, task);
    account(entry.receipt, task.url);
    if (dentonFingerprint(entry) !== dentonFingerprint(original))
      throw new Error(
        task.kind === "model" && original.kind === "model"
          ? `Closing re-read of model page ${task.make.label} ${task.model.label} differs from its opening read of ${original.page.records.length} cards under a badge of ${task.model.count}; a short page that does not repeat is never accepted, so nothing was staged`
          : "Closing ownership or make directory changed",
      );
  });
  if (state.pending) {
    const task = dentonNextTask(state);
    if (
      !task ||
      dentonReady({ ...state, pending: null }) ||
      state.pending.url !== task.url ||
      !dentonSlashRedirect(task.url, state.pending.target)
    )
      throw new Error("Pending redirect is outside the next literal control");
    requests++;
    bytes += state.pending.bytes;
  }
  if (state.requests !== requests || state.bytes !== bytes)
    throw new Error(
      "Checkpoint physical request/body accounting is inconsistent",
    );
  const graph = modelTasks(tasks);
  if (
    tasks.length > 1024 ||
    graph.length > DENTON_MAX_MODELS ||
    new Set(graph.map((task) => task.url)).size !== graph.length ||
    state.opening.reduce(
      (n, e) =>
        n +
        (e.kind === "model" || e.kind === "arrivals"
          ? e.page.records.length
          : 0),
      0,
    ) > 50_000
  )
    throw new Error("Checkpoint repeats or exceeds the bounded native graph");
  return state;

  function account(receipt: DentonEntry["receipt"], url: string) {
    if (receipt.redirect) {
      if (
        receipt.redirect.url !== url ||
        !dentonSlashRedirect(url, receipt.redirect.target) ||
        receipt.url !== receipt.redirect.target
      )
        throw new Error(
          "Checkpoint redirect lost its original literal destination",
        );
      requests++;
      bytes += receipt.redirect.bytes;
    } else if (receipt.url !== url)
      throw new Error("Checkpoint response destination changed");
    requests++;
    bytes += receipt.bytes;
  }
}
function active(cursor: DentonCursor): DentonProgress {
  if (cursor.phase !== "active")
    throw new Error("Completed checkpoint has no further native transition");
  return cursor;
}
function checkpoint(
  input: Omit<DentonProgress, "checksum"> | DentonProgress,
  previousAcceptedCount: number | null,
): DentonProgress {
  const unsigned = progress.parse({ ...input, checksum: "0".repeat(64) });
  return active(
    validate(
      { ...unsigned, checksum: checksum(unsigned) },
      previousAcceptedCount,
    ),
  );
}
function seal(census: DentonCensus): DentonTerminal {
  const unsigned = terminal.parse({
    source: "denton",
    version: 1,
    checksum: "0".repeat(64),
    phase: "complete",
    census,
  });
  const sealed = { ...unsigned, checksum: checksum(unsigned) };
  validate(sealed, null);
  return sealed;
}
export const DentonCursor = {
  initial(previousAcceptedCount: number | null): DentonResult<DentonCursor> {
    return dentonBoundary("initial checkpoint", () =>
      checkpoint(
        {
          source: "denton",
          version: 1,
          scope: scope(previousAcceptedCount),
          phase: "active",
          opening: [],
          closing: [],
          pending: null,
          requests: 0,
          bytes: 0,
          day: null,
          previous: null,
        },
        previousAcceptedCount,
      ),
    );
  },
  parse(input: unknown, previousAcceptedCount: number | null) {
    return dentonBoundary("checkpoint", () =>
      validate(input, previousAcceptedCount),
    );
  },
  fromWire(raw: string, previousAcceptedCount: number | null) {
    return dentonBoundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > DENTON_MAX_CURSOR_BYTES)
        throw new Error("Checkpoint wire exceeds 16 MiB");
      return validate(JSON.parse(raw), previousAcceptedCount);
    });
  },
  serialize(state: DentonCursor, previousAcceptedCount: number | null) {
    return dentonBoundary("checkpoint serialization", () =>
      JSON.stringify(validate(state, previousAcceptedCount)),
    );
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning; a missing
   * previous cursor is a silent cold start. */
  begin(
    input: DentonCursor,
    now: number,
    previousCursor: unknown,
    previousAcceptedCount: number | null,
  ): DentonResult<{ cursor: DentonCursor; warning: string | null }> {
    return dentonBoundary("begin census", () => {
      const state = validate(input, previousAcceptedCount);
      if (state.phase === "complete" || state.day !== null)
        return { cursor: state, warning: null };
      const day = ModelCensus.day(now);
      const parsed = terminal.safeParse(previousCursor ?? undefined);
      const previous =
        parsed.success && parsed.data.checksum === checksum(parsed.data)
          ? ModelCensus.previous(parsed.data.census, censusContract, day)
          : {
              kind: "cold" as const,
              warning:
                previousCursor === null || previousCursor === undefined
                  ? null
                  : "Previous Denton checkpoint is not a readable terminal census; reading every model page.",
            };
      return {
        cursor: checkpoint(
          {
            ...state,
            day,
            previous: previous.kind === "incremental" ? previous.census : null,
          },
          previousAcceptedCount,
        ),
        warning: previous.kind === "cold" ? previous.warning : null,
      };
    });
  },
  /** Seals a fully closed run into its terminal census. */
  complete(input: DentonCursor, previousAcceptedCount: number | null) {
    return dentonBoundary("terminal checkpoint", () => {
      const state = active(validate(input, previousAcceptedCount));
      if (!dentonReady(state) || state.day === null)
        throw new Error("Opening/closing proof is incomplete");
      return seal(
        ModelCensus.accept(
          censusContract,
          state.day,
          censusControls(modelTasks(dentonTasks(state.opening))),
          modelEntries(state.opening),
          dentonCensusPlan(state),
        ),
      );
    });
  },
  advance(
    input: DentonCursor,
    response: DentonResponse,
    previousAcceptedCount: number | null,
  ) {
    return dentonBoundary("native transition", () => {
      const state = active(validate(input, previousAcceptedCount));
      if (state.day === null)
        throw new Error("Begin the run census before the first native request");
      const next = dentonNextUrl(state);
      if (!next.ok) throw new Error(next.error.message);
      const result = DentonResponseSchema.parse(response),
        size = Buffer.byteLength(result.body);
      if (
        result.url !== next.value ||
        size > DENTON_MAX_BODY_BYTES ||
        state.requests >= DENTON_MAX_REQUESTS ||
        state.bytes + size > DENTON_MAX_TOTAL_BYTES
      )
        throw new Error(
          "Native response destination or whole-run request/body bound changed",
        );
      const base = {
        ...state,
        requests: state.requests + 1,
        bytes: state.bytes + size,
      };
      if (result.kind === "redirect") {
        if (state.pending || !dentonSlashRedirect(result.url, result.target))
          throw new Error(
            "Unexpected redirect, redirect chain or foreign destination",
          );
        return checkpoint(
          {
            ...base,
            pending: {
              url: result.url,
              target: result.target,
              bytes: size,
              bodyHash: dentonHash(result.body),
            },
          },
          previousAcceptedCount,
        );
      }
      if (!size) throw new Error("Native HTML document is empty");
      const task = dentonNextTask(state);
      if (!task) throw new Error("Native response has no published task");
      const entry = dentonParseEntry(
        result.body,
        task,
        {
          url: result.url,
          bytes: size,
          bodyHash: dentonHash(result.body),
          redirect: state.pending,
        },
        state.opening,
      );
      if (state.opening.length >= dentonTasks(state.opening).length)
        return checkpoint(
          { ...base, pending: null, closing: [...state.closing, entry] },
          previousAcceptedCount,
        );
      const opening = [...state.opening, entry];
      // Carried models up to the next due read cost no request.
      if (task.kind === "arrivals" || task.kind === "model")
        opening.push(
          ...ModelCensus.carriedRun(
            dentonCensusPlan({ ...state, opening }),
            task.kind === "arrivals"
              ? 0
              : modelEntries(state.opening).length + 1,
          ),
        );
      return checkpoint(
        { ...base, pending: null, opening },
        previousAcceptedCount,
      );
    });
  },
} as const;
