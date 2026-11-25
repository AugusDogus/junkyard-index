import { z } from "zod";
import {
  ModelCensus,
  type ModelCensusControl,
  type ModelCensusDecision,
} from "./model-census";
import {
  Six03CatalogSchema,
  Six03DetailSchema,
  Six03PostSchema,
  six03Hash,
  type Six03Catalog,
  type Six03Detail,
  type Six03Post,
} from "./six03-parser";
import { six03PendingPosts } from "./six03-snapshot";
import { SIX03_YARD } from "./six03-yard-metadata";

// A full in-run cursor is about 0.8 MB for 1,023 fetched donors and the
// previous census adds about 1 MB, so 4 MiB leaves room for the roster cap.
export const SIX03_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
export const SIX03_MAX_REQUESTS = 1210;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = six03Hash({
  yard: SIX03_YARD,
  authority: "native-unit-data/raw-model/all-owned-destination-conflicts-v1",
});

/** Bump whenever parseSix03Detail, the detail projection or the census key
 * changes, so carried articles from the old contract are read again. */
const censusContract = six03Hash({
  scope,
  census: "incremental-donor-census-v1",
});

/** Census key of a fetched donor: its card path, then a hash of its whole
 * catalog card, which the detail parser and transform bind, so a changed card
 * is read again (reason `new`). The hash keeps escaped card text inside the
 * census key cap. A donor path never contains a newline. */
export const six03CensusKey = (post: Six03Post) =>
  post[0] + "\n" + six03Hash(post);

/** Catalog card path a census key binds, or null when the key is not a card key. */
function censusKeyPath(key: string): string | null {
  const split = key.indexOf("\n");
  if (split < 0) return null;
  const path = key.slice(0, split);
  return Six03PostSchema.items[0].safeParse(path).success &&
    hash.safeParse(key.slice(split + 1)).success
    ? path
    : null;
}

/** Every donor article fetched by an accepted run, carried forward by the
 * next one. Evidence failing its projection, or stored under another donor's
 * card, makes the terminal cursor unreadable, so the next run starts a warned
 * cold census instead of failing on the carried donor. */
export const Six03CensusSchema = ModelCensus.schema(
  Six03DetailSchema,
  1200,
).superRefine((census, context) => {
  if (
    census.models.some(
      (m) =>
        m.count !== 1 ||
        m.page.kind !== "article" ||
        censusKeyPath(m.key) !== m.page.path,
    )
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "603 census donor evidence does not match its catalog card",
    });
});
export type Six03Census = z.infer<typeof Six03CensusSchema>;

const progress = z
  .object({
    source: z.literal("six03"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["contact", "catalog", "details", "closing"]),
    contact: hash.nullable(),
    catalog: Six03CatalogSchema.nullable(),
    details: z.array(Six03DetailSchema).max(1200),
    closing: z.number().int().min(0).max(3),
    requests: z.number().int().min(0).max(SIX03_MAX_REQUESTS),
    /** UTC run day fixed before the first request; null only in the initial cursor. */
    day: z.number().int().nonnegative().safe().nullable(),
    /** Compatible census from the last accepted run, or null for a cold census. */
    previous: Six03CensusSchema.nullable(),
  })
  .strict();
export type Six03Progress = z.infer<typeof progress>;

/** A donor article lists exactly one donor, so no fetched page is short. */
const six03Cards = (_page: Six03Detail) => 1;

function six03CensusControls(catalog: Six03Catalog): ModelCensusControl[] {
  return six03PendingPosts(catalog).map((post) => ({
    key: six03CensusKey(post),
    count: 1,
  }));
}

type Six03CensusState = Pick<Six03Progress, "previous" | "day"> & {
  catalog: Six03Catalog;
};

/**
 * Fetch or carry each donor the catalog lists without an embedded excerpt.
 * Membership still comes from the complete catalog on every run, so a sold
 * donor drops out and a new or changed card is fetched; an unchanged card
 * carries its last accepted article until its six-day sweep.
 */
export function six03CensusPlan(
  state: Six03CensusState,
): ModelCensusDecision<Six03Detail>[] {
  if (state.day === null) throw new Error("603 census plan needs a run day");
  return ModelCensus.plan(
    six03CensusControls(state.catalog),
    state.previous,
    state.day,
    { cards: six03Cards, reuse: "unchanged-key" },
  );
}

/** Pending-donor indices closing re-reads: the first and last donor fetched
 * this run, so closing confirms this run's observations held. When every
 * donor carried, the first and last carried donors are compared with their
 * live pages instead. Null when the catalog lists no donor to fetch. */
export function six03ClosingDonors(
  state: Six03CensusState,
): readonly [number, number] | null {
  const decisions = six03CensusPlan(state);
  if (decisions.length === 0) return null;
  const reads = decisions.flatMap((decision, index) =>
    decision.kind === "read" ? [index] : [],
  );
  return [reads[0] ?? 0, reads.at(-1) ?? decisions.length - 1];
}

/** Terminal census for a fully closed run. */
export function six03Census(state: Six03Progress): Six03Census {
  if (state.day === null || state.catalog === null)
    throw new Error("603 census has no run day or catalog");
  const catalog = state.catalog;
  return ModelCensus.accept(
    censusContract,
    state.day,
    {
      controls: six03CensusControls(catalog),
      pages: state.details,
      decisions: six03CensusPlan({ ...state, catalog }),
      previous: state.previous,
      cards: six03Cards,
    },
    // No donor page is ever below its count of one.
    "confirmed",
  );
}
const checksum = (state: Omit<Six03Progress, "checksum"> | Six03Progress) =>
  six03Hash([
    state.source,
    state.version,
    state.scope,
    state.phase,
    state.contact,
    state.catalog,
    state.details,
    state.closing,
    state.requests,
    state.day,
    state.previous,
  ]);
export const Six03CursorSchema = z
  .discriminatedUnion("phase", [
    progress,
    z
      .object({
        source: z.literal("six03"),
        version: z.literal(1),
        phase: z.literal("complete"),
        // Pre-incremental terminal cursors stay readable but seed a cold census.
        census: Six03CensusSchema.optional(),
      })
      .strict(),
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > SIX03_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "603 checkpoint exceeds 4 MiB or its integrity changed",
        );
      const stages = ["contact", "catalog", "details", "closing"];
      const stage = stages.indexOf(state.phase);
      if (
        (stage === 0) !== (state.contact === null) ||
        stage < 2 !== (state.catalog === null)
      )
        throw new Error(
          "603 checkpoint phase lost its native owner/catalog evidence",
        );
      const posts = state.catalog ? six03PendingPosts(state.catalog) : [];
      if (
        (stage < 2 && state.details.length !== 0) ||
        state.details.length > posts.length ||
        (stage === 2 && state.details.length >= posts.length) ||
        (stage === 3 && state.details.length !== posts.length) ||
        state.details.some(
          (row, index) =>
            row.kind !== "article" || row.path !== posts[index]?.[0],
        ) ||
        (stage < 3 && state.closing !== 0)
      )
        throw new Error(
          "603 checkpoint detail/closing evidence is not a contiguous native membership prefix",
        );
      if (
        state.day === null
          ? state.requests !== 0 || state.previous !== null
          : state.previous !== null &&
            (state.previous.contract !== censusContract ||
              state.previous.day > state.day)
      )
        throw new Error("603 run day or previous census is inconsistent");
      // Carried donors are exactly the previous census evidence and cost no GET.
      let fetched = 0;
      if (state.catalog !== null) {
        const decisions = six03CensusPlan({ ...state, catalog: state.catalog });
        state.details.forEach((row, index) => {
          const decision = decisions[index];
          if (decision?.kind === "read") fetched++;
          else if (decision?.evidence.page.projection !== row.projection)
            throw new Error("603 carried donor differs from its census");
        });
        if (stage === 2 && decisions[state.details.length]?.kind !== "read")
          throw new Error("603 next donor is not due for a read");
      }
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          (state.catalog === null ? 0 : 1) +
          fetched +
          state.closing
      )
        throw new Error("603 checkpoint native request accounting changed");
    } catch (cause) {
      context.addIssue({
        code: "custom",
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid 603 native checkpoint",
      });
    }
  });
export type Six03Cursor = z.infer<typeof Six03CursorSchema>;
const initial: Omit<Six03Progress, "checksum"> = {
  source: "six03",
  version: 1,
  scope,
  phase: "contact",
  contact: null,
  catalog: null,
  details: [],
  closing: 0,
  requests: 0,
  day: null,
  previous: null,
};
export const Six03Cursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(wire: string): Six03Cursor {
    if (Buffer.byteLength(wire) > SIX03_MAX_CURSOR_BYTES)
      throw new Error(
        "603 cursor wire payload exceeds 4 MiB; retain the previous checkpoint",
      );
    const value: unknown = JSON.parse(wire);
    return Six03CursorSchema.parse(value);
  },
  serialize(cursor: Six03Cursor): string {
    return JSON.stringify(Six03CursorSchema.parse(cursor));
  },
  /** Fixes the run day and adopts the last accepted census before the first
   * request. Anything unusable starts a cold census with a warning. */
  begin(
    cursor: Six03Progress,
    now: number,
    previousCursor: unknown,
  ): { cursor: Six03Progress; warning: string | null } {
    if (cursor.day !== null) return { cursor, warning: null };
    const day = ModelCensus.day(now);
    const parsed = Six03CursorSchema.safeParse(previousCursor ?? undefined);
    const previous =
      parsed.success && parsed.data.phase === "complete"
        ? ModelCensus.previous(parsed.data.census, censusContract, day)
        : {
            kind: "cold" as const,
            warning:
              previousCursor === null || previousCursor === undefined
                ? null
                : "Previous 603 checkpoint is not a readable terminal census; reading every donor page.",
          };
    return {
      cursor: Six03Cursor.checkpoint({
        ...cursor,
        day,
        previous: previous.kind === "incremental" ? previous.census : null,
      }),
      warning: previous.kind === "cold" ? previous.warning : null,
    };
  },
  checkpoint(
    state: Omit<Six03Progress, "checksum"> | Six03Progress,
  ): Six03Progress {
    const value = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = Six03CursorSchema.parse({
      ...value,
      checksum: checksum(value),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable 603 checkpoint");
    return parsed;
  },
} as const;
