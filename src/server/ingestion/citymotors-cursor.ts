import { z } from "zod";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";
import {
  citymotorsHash,
  citymotorsCatalogHash,
  CitymotorsCatalogSchema,
  CitymotorsRecordSchema,
  type CitymotorsCatalog,
  type CitymotorsPost,
  type CitymotorsRecord,
} from "./citymotors-parser";
import {
  citymotorsSnapshot,
  validateCitymotorsSnapshot,
} from "./citymotors-transform";
import {
  CITYMOTORS_CATALOG,
  CITYMOTORS_YARD,
  citymotorsCatalogPage,
} from "./citymotors-yard-metadata";

// A full in-run cursor is about 0.3 MB for 199 donors and the previous census
// adds about as much again, so 4 MiB leaves room for the 1,024-donor cap.
export const CITYMOTORS_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
export const CITYMOTORS_MAX_REQUESTS = 1088;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = { source: z.literal("citymotors"), version: z.literal(1) };
const scope = citymotorsHash({
  yard: CITYMOTORS_YARD,
  contract:
    "native-primary-fields/reviewed-wording/no-character-repair/all-page-closure-v1",
});

/** Bump whenever parseCitymotorsDetail, the record schema or the census key
 * changes, so donors carried under the old contract are read again. */
const censusContract = citymotorsHash({
  scope,
  census: "incremental-donor-census-v1",
});

/** Census key of a donor: its URL, then a hash of its whole catalog card (URL,
 * title and photo), so a card whose title or photo changed is read again
 * (reason `new`). A donor URL never contains a newline. */
export const citymotorsCensusKey = (post: CitymotorsPost) =>
  post.url + "\n" + citymotorsHash(post);

/** Every donor record of an accepted run, carried forward by the next one.
 * Evidence stored under another card makes the terminal cursor unreadable, so
 * the next run starts a warned cold census instead of failing on it. */
export const CitymotorsCensusSchema = ModelCensus.schema(
  CitymotorsRecordSchema,
  1024,
).superRefine((census, context) => {
  if (
    census.models.some(
      (m) => m.count !== 1 || m.key !== citymotorsCensusKey(m.page.post),
    )
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "City Motors census donor evidence does not match its card",
    });
});
export type CitymotorsCensus = z.infer<typeof CitymotorsCensusSchema>;

const progress = {
  ...base,
  scope: z.literal(scope),
  checksum: hash,
  pages: z.array(CitymotorsCatalogSchema).max(32),
  /** The host rate-limited the next GET; the durable Workflow sleeps until
   * this time before that GET is sent again. */
  retryAt: z.number().int().nonnegative().safe().optional(),
  /** UTC run day fixed before the first GET; null only in the initial cursor. */
  day: z.number().int().nonnegative().safe().nullable(),
  /** Compatible census from the last accepted run, or null for a cold census. */
  previous: CitymotorsCensusSchema.nullable(),
};
const records = z.array(CitymotorsRecordSchema).max(1024);
const ProgressSchema = z.discriminatedUnion("phase", [
  z.object({ ...progress, phase: z.literal("catalog") }).strict(),
  z.object({ ...progress, phase: z.literal("details"), records }).strict(),
  z
    .object({
      ...progress,
      phase: z.literal("closing"),
      records,
      closing: z.number().int().min(0).max(32),
      /** Donor URLs whose card photo the closing catalog showed changed. The
       * census keeps the cards as first read; the snapshot drops their photo. */
      photoDrift: z.array(z.string()).max(1024),
    })
    .strict(),
]);
export type CitymotorsProgress = z.infer<typeof ProgressSchema>;
function checksum(state: CitymotorsProgress) {
  return citymotorsHash({ ...state, checksum: null });
}

/** A donor card lists exactly one donor, so no record is short. */
const citymotorsCards = (_record: CitymotorsRecord) => 1;

const posts = (pages: readonly CitymotorsCatalog[]) =>
  pages.flatMap((page) => page.posts);

function censusControls(
  pages: readonly CitymotorsCatalog[],
): ModelCensusControl[] {
  return posts(pages).map((post) => ({
    key: citymotorsCensusKey(post),
    count: 1,
  }));
}

/**
 * Read or carry each donor of the complete catalog. Membership comes from the
 * catalog read this run, so a donor no longer listed drops out and a new or
 * changed card is read; an unchanged card carries its last accepted record
 * until its six-day sweep. A run after a missed or failed day reads every
 * donor again.
 */
export function citymotorsCensusPlan(
  state: Pick<CitymotorsProgress, "pages" | "day" | "previous">,
): ModelCensusDecision<CitymotorsRecord>[] {
  if (state.day === null)
    throw new Error("City Motors census plan needs a run day");
  return ModelCensus.plan(
    censusControls(state.pages),
    state.previous,
    state.day,
    {
      cards: citymotorsCards,
      reuse: "unchanged-key",
    },
  );
}

/** Records as published: a donor whose card photo changed by closing has none. */
export function citymotorsPublishedRecords(
  state: Extract<CitymotorsProgress, { phase: "closing" }>,
): CitymotorsRecord[] {
  const drift = new Set(state.photoDrift);
  return state.records.map((record) =>
    drift.has(record.post.url)
      ? { ...record, post: { ...record.post, imageUrl: null } }
      : record,
  );
}

/** Terminal census for a fully closed run. */
export function citymotorsCensus(
  state: Extract<CitymotorsProgress, { phase: "closing" }>,
): CitymotorsCensus {
  if (state.day === null) throw new Error("City Motors census has no run day");
  return ModelCensus.accept(
    censusContract,
    state.day,
    {
      controls: censusControls(state.pages),
      pages: state.records,
      decisions: citymotorsCensusPlan(state),
      previous: state.previous,
      cards: citymotorsCards,
    },
    // No donor page is ever below its count of one.
    "confirmed",
  );
}

export const CitymotorsCursorSchema = z
  .union([
    z
      .object({
        ...base,
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: CitymotorsCensusSchema.optional(),
      })
      .strict(),
    ProgressSchema,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) >
          CITYMOTORS_MAX_CURSOR_BYTES ||
        checksum(state) !== state.checksum
      )
        throw new Error("City Motors checkpoint size or integrity changed");
      if (
        state.day === null
          ? state.phase !== "catalog" ||
            state.pages.length !== 0 ||
            state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== censusContract ||
              state.previous.day > state.day)
      )
        throw new Error(
          "City Motors checkpoint run day or previous census is inconsistent",
        );
      const first = state.pages[0];
      const listed = posts(state.pages);
      if (
        (first && first.url !== CITYMOTORS_CATALOG) ||
        new Set(listed.map((post) => post.url)).size !== listed.length
      )
        throw new Error(
          "City Motors checkpoint repeats or skips native catalog destinations",
        );
      for (const [index, page] of state.pages.entries()) {
        if (
          page.page !== index + 1 ||
          citymotorsCatalogPage(page.url) !== page.page ||
          page.page > page.lastPage ||
          page.lastPage !== first?.lastPage ||
          (index > 0 && state.pages[index - 1]?.next !== page.url) ||
          page.hash !== citymotorsCatalogHash(page) ||
          (page.page < page.lastPage
            ? citymotorsCatalogPage(page.next ?? "") !== page.page + 1 ||
              page.posts.length !== 32
            : page.next !== null)
        )
          throw new Error(
            "City Motors native catalog checkpoint is not a contiguous validated prefix",
          );
      }
      const last = state.pages.at(-1);
      if (state.phase === "catalog") {
        if (last?.next === null)
          throw new Error(
            "City Motors terminal catalog cannot remain in catalog phase",
          );
        return;
      }
      if (
        !first ||
        !last ||
        last.next !== null ||
        state.pages.length !== first.lastPage ||
        state.records.some(
          (record, index) =>
            JSON.stringify(record.post) !== JSON.stringify(listed[index]),
        )
      )
        throw new Error(
          "City Motors donor checkpoint does not bind to its complete native catalog",
        );
      if (
        state.phase === "details"
          ? state.records.length >= listed.length
          : state.records.length !== listed.length ||
            state.closing > state.pages.length
      )
        throw new Error("City Motors donor or closing prefix is inconsistent");
      // Carried donors are exactly the previous census evidence and cost no
      // GET; the next donor a details checkpoint names is due for a read.
      const decisions = citymotorsCensusPlan(state);
      if (
        state.records.some((record, index) => {
          const decision = decisions[index];
          return (
            decision?.kind === "carry" &&
            JSON.stringify(decision.evidence.page) !== JSON.stringify(record)
          );
        }) ||
        (state.phase === "details" &&
          decisions[state.records.length]?.kind !== "read")
      )
        throw new Error(
          "City Motors carried donor differs from its census, or the next donor is not due for a read",
        );
      if (state.phase === "closing") {
        const closed = new Set(
          posts(state.pages.slice(0, state.closing)).map((post) => post.url),
        );
        if (
          new Set(state.photoDrift).size !== state.photoDrift.length ||
          state.photoDrift.some((url) => !closed.has(url))
        )
          throw new Error(
            "City Motors closing photo drift names a donor no closed page lists",
          );
        validateCitymotorsSnapshot(
          citymotorsSnapshot(citymotorsPublishedRecords(state)),
        );
      } else citymotorsSnapshot(state.records);
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid City Motors checkpoint",
      });
    }
  });
export type CitymotorsCursor = z.infer<typeof CitymotorsCursorSchema>;
function checkpoint(value: unknown): CitymotorsProgress {
  const canonical = ProgressSchema.parse(value);
  const parsed = CitymotorsCursorSchema.parse({
    ...canonical,
    checksum: checksum(canonical),
  });
  if (parsed.phase === "complete")
    throw new Error("Expected resumable City Motors checkpoint");
  return parsed;
}
const tooLarge =
  "City Motors checkpoint wire payload exceeds 4 MiB; retain the last validated checkpoint";
export const CitymotorsCursor = {
  initial: checkpoint({
    source: "citymotors",
    version: 1,
    scope,
    checksum: "0".repeat(64),
    phase: "catalog",
    pages: [],
    day: null,
    previous: null,
  }),
  checkpoint,
  /** The progress a GET resumes from, without its elapsed rate-limit wait. */
  resume(progress: CitymotorsProgress): CitymotorsProgress {
    if (progress.retryAt === undefined) return progress;
    const resumed = { ...progress };
    delete resumed.retryAt;
    return checkpoint(resumed);
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * GET. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: CitymotorsProgress,
    now: number,
    previousCursor: unknown,
  ): { cursor: CitymotorsProgress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = CitymotorsCursorSchema.safeParse(
      previousCursor ?? undefined,
    );
    const previous =
      parsed.success && parsed.data.phase === "complete"
        ? ModelCensus.previous(parsed.data.census, censusContract, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous City Motors checkpoint is not a readable terminal census; reading every donor page.",
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
  parse(raw: string): CitymotorsCursor {
    if (Buffer.byteLength(raw) > CITYMOTORS_MAX_CURSOR_BYTES)
      throw new Error(tooLarge);
    const value: unknown = JSON.parse(raw);
    return CitymotorsCursorSchema.parse(value);
  },
  serialize(cursor: CitymotorsCursor): string {
    const raw = JSON.stringify(CitymotorsCursorSchema.parse(cursor));
    if (Buffer.byteLength(raw) > CITYMOTORS_MAX_CURSOR_BYTES)
      throw new Error(tooLarge);
    return raw;
  },
} as const;
