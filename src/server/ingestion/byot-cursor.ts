import { createHash } from "node:crypto";
import { z } from "zod";
import { BYOT_YARDS } from "./byot-configuration";
import { BYOT_QUERIES } from "./byot-directory";
import { ByotResult } from "./byot-result";
import { IngestionDay } from "./ingestion-day";

export const BYOT_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
export const BYOT_RETIRED_QUERY_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;
/** Each daily run reads every yard's feed and searches every query at every
 * yard: 6,695 serial requests, about five hours at the qualified two-second
 * pacing. A resumed run older than this fails instead of publishing stale
 * search evidence. */
export const BYOT_MAX_RUN_MS = 8 * 60 * 60 * 1000;
export const BYOT_RUN_REQUESTS = BYOT_YARDS.length * (1 + BYOT_QUERIES.length);
/** Expected time per request: the measured 0.6-0.7 s response plus the
 * two-second pause. A retry resumes a failed attempt only when its remaining
 * requests at this pace still end inside `BYOT_MAX_RUN_MS`. */
export const BYOT_EXPECTED_REQUEST_MS = 2_700;
/** Request cap per chunk, which normally ends a chunk. When responses are
 * slow, the connector stops earlier, once one more request could overrun the
 * chunk deadline. */
export const BYOT_CHUNK_REQUESTS = 64;
/** Published cursors from the retired weekly sweep searched a seventh of
 * their directory. They still seed the next daily run. */
export const byotLegacySliceQueries = (directoryLength: number) =>
  Math.ceil(directoryLength / 7);
export const byotHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function byotQueryKey(index: number): string {
  const query = BYOT_QUERIES[index];
  if (!query)
    throw new Error(`BYOT query ${index} is outside the qualified directory`);
  return byotHash(query);
}
const directory = BYOT_QUERIES.map((_, index) => byotQueryKey(index));
const scopeFor = (queries: readonly string[]) =>
  byotHash({ yards: BYOT_YARDS, queries });
const scope = scopeFor(directory);
const currentQueries = new Set(directory);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const records = z.array(z.unknown()).max(4999);
const bucket = z
  .object({
    query: digest,
    checkedAt: z.number().int().nonnegative(),
    records,
  })
  .strict();
// Retired queries can coexist with the current directory, bounded by the wire cap.
const cache = z.array(z.array(bucket)).length(BYOT_YARDS.length);
const base = {
  source: z.literal("byot"),
  version: z.literal(1),
  scope: digest,
  directory: z.array(digest).min(1),
  checksum: digest,
};
const active = {
  ...base,
  startedAt: z.number().int().nonnegative(),
  sweepStart: z
    .number()
    .int()
    .min(0)
    .max(BYOT_QUERIES.length - 1),
  cache,
  previousCounts: z
    .array(z.number().int().nonnegative())
    .max(BYOT_YARDS.length),
  /** When this attempt began sending and how many requests the sweep had
   * sent by then, so a chunk can measure the attempt's pace. Absent on
   * checkpoints saved before pace tracking, which skip the projection. */
  paceFrom: z
    .object({
      at: z.number().int().nonnegative(),
      sent: z.number().int().nonnegative(),
    })
    .strict()
    .optional(),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("initial") }).strict(),
  z
    .object({
      ...active,
      phase: z.literal("arrivals"),
      feeds: z.array(records).max(BYOT_YARDS.length - 1),
    })
    .strict(),
  z
    .object({
      ...active,
      phase: z.literal("search"),
      feeds: z.array(records).length(BYOT_YARDS.length),
      progress: z
        .number()
        .int()
        .min(0)
        .max(BYOT_QUERIES.length * BYOT_YARDS.length - 1),
    })
    .strict(),
  z
    .object({
      ...active,
      phase: z.literal("ready"),
      feeds: z.array(records).length(BYOT_YARDS.length),
    })
    .strict(),
  z
    .object({
      ...base,
      phase: z.literal("complete"),
      completedAt: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative(),
      cache,
      yardCounts: z
        .array(z.number().int().nonnegative())
        .length(BYOT_YARDS.length),
    })
    .strict(),
]);
export type ByotCursor = z.infer<typeof schema>;
export type ByotCache = z.infer<typeof cache>;
/** A sweep that still has requests to send. */
export type ByotSweepCursor = Extract<
  ByotCursor,
  { phase: "arrivals" | "search" }
>;
/** Whether a retry continues a failed attempt or starts a fresh sweep, and
 * why not. */
export type ByotResumption =
  | { kind: "resume"; cursor: ByotCursor }
  | { kind: "fresh"; reason: string };
/** Requests a sweep has sent, including the yard feeds. */
export function byotRequestsSent(cursor: ByotSweepCursor): number {
  return cursor.phase === "arrivals"
    ? cursor.feeds.length
    : BYOT_YARDS.length + cursor.progress;
}
type Unsigned<C = ByotCursor> = C extends { checksum: string }
  ? Omit<C, "checksum">
  : never;
/** A cursor before `ByotCursor.checkpoint` seals and validates it. */
export type ByotCursorState = Unsigned;
const checksum = (cursor: ByotCursor | Unsigned) =>
  byotHash({ ...cursor, checksum: undefined });
function validate(input: unknown): ByotCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > BYOT_MAX_CURSOR_BYTES)
    throw new Error("Checkpoint exceeds 16 MiB");
  const cursor = schema.parse(input);
  if (
    cursor.checksum !== checksum(cursor) ||
    cursor.scope !== scopeFor(cursor.directory)
  )
    throw new Error("Checkpoint checksum or qualified directory changed");
  const queries = new Set(cursor.directory);
  if (queries.size !== cursor.directory.length)
    throw new Error("Checkpoint directory repeats a query");
  if (cursor.phase !== "complete" && cursor.scope !== scope)
    throw new Error(
      "Active checkpoint directory changed; restart from the prior published cursor",
    );
  if (
    cursor.phase === "complete" &&
    cursor.nextOffset >= cursor.directory.length
  )
    throw new Error("Next search offset is outside the checkpoint directory");
  if (cursor.phase === "initial") return cursor;
  if (
    "previousCounts" in cursor &&
    cursor.previousCounts.length !== 0 &&
    cursor.previousCounts.length !== BYOT_YARDS.length
  )
    throw new Error("Previous yard counts are incomplete");
  if (
    (cursor.phase === "arrivals" || cursor.phase === "search") &&
    cursor.paceFrom !== undefined &&
    (cursor.paceFrom.at < cursor.startedAt ||
      cursor.paceFrom.sent > byotRequestsSent(cursor))
  )
    throw new Error(
      "Pace origin precedes the run or counts more requests than were sent",
    );
  const now = "startedAt" in cursor ? cursor.startedAt : cursor.completedAt;
  for (const yard of cursor.cache) {
    if (new Set(yard.map((entry) => entry.query)).size !== yard.length)
      throw new Error("Search cache repeats a query");
    if (
      yard.some(
        (entry) =>
          entry.checkedAt > now ||
          (!queries.has(entry.query) &&
            now - entry.checkedAt > BYOT_RETIRED_QUERY_MAX_AGE_MS),
      )
    )
      throw new Error("Search evidence is expired or dated in the future");
  }
  // Prove this run's complete contiguous search prefix before accepting a checkpoint.
  // A complete cursor only has to prove a weekly slice, which every daily
  // sweep also proves, so cursors published before daily sweeps still load.
  if (
    cursor.phase === "search" ||
    cursor.phase === "ready" ||
    cursor.phase === "complete"
  ) {
    const queries =
      cursor.phase === "complete"
        ? byotLegacySliceQueries(cursor.directory.length)
        : cursor.directory.length;
    const progress =
      cursor.phase === "search" ? cursor.progress : queries * BYOT_YARDS.length;
    const start =
      cursor.phase === "complete"
        ? (cursor.nextOffset - queries + cursor.directory.length) %
          cursor.directory.length
        : cursor.sweepStart;
    for (let i = 0; i < progress; i++) {
      const index =
        (start + Math.floor(i / BYOT_YARDS.length)) % cursor.directory.length;
      const entry = cursor.cache[i % BYOT_YARDS.length]?.find(
        (item) => item.query === cursor.directory[index],
      );
      if (!entry || entry.checkedAt !== now)
        throw new Error(
          `Checkpoint lacks this run's contiguous search evidence for yard ${BYOT_YARDS[i % BYOT_YARDS.length]?.code ?? "unknown"} query ${index}, so it was rejected. Published inventory is unchanged. If this checkpoint was saved by a run, that run ends and the next attempt starts a fresh sweep; if it is the latest publication, restore a complete published cursor`,
        );
    }
  }
  return cursor;
}
function seal(state: Unsigned): ByotCursor {
  const canonical = schema.parse({ ...state, checksum: "0".repeat(64) });
  return validate({ ...canonical, checksum: checksum(canonical) });
}
export const ByotCursor = {
  initial: (): ByotCursor =>
    seal({ source: "byot", version: 1, scope, directory, phase: "initial" }),
  parse: (input: unknown) =>
    ByotResult.boundary("checkpoint", () => validate(input)),
  checkpoint: (state: Unsigned) =>
    ByotResult.boundary("checkpoint transition", () => seal(state)),
  fromWire: (raw: string) =>
    ByotResult.boundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > BYOT_MAX_CURSOR_BYTES)
        throw new Error("Checkpoint exceeds 16 MiB");
      return validate(JSON.parse(raw));
    }),
  serialize: (cursor: ByotCursor) =>
    ByotResult.boundary("checkpoint serialization", () =>
      JSON.stringify(validate(cursor)),
    ),
  begin(previous: ByotCursor | null, now: number) {
    return ByotResult.boundary("daily sweep initialization", () => {
      if (previous !== null) validate(previous);
      if (previous !== null && previous.phase !== "complete")
        throw new Error("Previous sweep is not a complete published run");
      if (previous?.phase === "complete" && now < previous.completedAt)
        throw new Error("Previous publication is dated in the future");
      return seal({
        source: "byot",
        version: 1,
        scope,
        directory,
        phase: "arrivals",
        startedAt: now,
        sweepStart:
          previous?.phase === "complete" && previous.scope === scope
            ? previous.nextOffset
            : 0,
        cache:
          previous?.phase === "complete"
            ? previous.cache.map((yard) =>
                yard.filter(
                  (entry) =>
                    currentQueries.has(entry.query) ||
                    now - entry.checkedAt <= BYOT_RETIRED_QUERY_MAX_AGE_MS,
                ),
              )
            : BYOT_YARDS.map(() => []),
        previousCounts:
          previous?.phase === "complete" ? previous.yardCounts : [],
        paceFrom: { at: now, sent: 0 },
        feeds: [],
      });
    });
  },
  /**
   * Decides whether a retry continues the last checkpoint of a failed attempt
   * (`failedWire`) instead of starting a fresh sweep from `previous`, the
   * latest publication. It continues only a sweep with requests left, begun
   * from that publication on the same ingestion day, whose remaining requests
   * at the expected pace still end inside the run limit. Its search evidence
   * keeps the attempt's start time, so the run limit spans every attempt.
   */
  resume(
    failedWire: string,
    previous: ByotCursor | null,
    now: number,
  ): ByotResumption {
    const fresh = (reason: string): ByotResumption => ({
      kind: "fresh",
      reason: `BYOT starts a fresh daily sweep instead of resuming the failed attempt: ${reason}`,
    });
    const parsed = ByotCursor.fromWire(failedWire);
    if (!parsed.ok)
      return fresh(`its checkpoint did not load (${parsed.error.message})`);
    const failed = parsed.value;
    if (failed.phase !== "arrivals" && failed.phase !== "search")
      return fresh(
        failed.phase === "ready"
          ? "it failed after every search (phase ready), and a fresh crawl can change data that failed snapshot validation"
          : `its checkpoint holds no sweep in progress (phase ${failed.phase})`,
      );
    if (
      IngestionDay.key(new Date(failed.startedAt)) !==
      IngestionDay.key(new Date(now))
    )
      return fresh(
        `it began on ingestion day ${IngestionDay.key(new Date(failed.startedAt))}, not today's`,
      );
    const remaining = BYOT_RUN_REQUESTS - byotRequestsSent(failed);
    const finish = now + remaining * BYOT_EXPECTED_REQUEST_MS;
    if (finish - failed.startedAt > BYOT_MAX_RUN_MS)
      return fresh(
        `its ${remaining} remaining requests would end at about ${new Date(finish).toISOString()}, after the ${BYOT_MAX_RUN_MS / 3_600_000}-hour limit for evidence from ${new Date(failed.startedAt).toISOString()}`,
      );
    // A publication is dated by its own run's start. The attempt began from
    // the latest one only when it started after it and carries its offset
    // and yard counts.
    const expected = ByotCursor.begin(previous, failed.startedAt);
    if (
      previous?.phase !== "complete" ||
      previous.completedAt > failed.startedAt ||
      !expected.ok ||
      expected.value.phase !== "arrivals" ||
      expected.value.sweepStart !== failed.sweepStart ||
      JSON.stringify(expected.value.previousCounts) !==
        JSON.stringify(failed.previousCounts)
    )
      return fresh(
        "it did not begin from the latest publication, so its carried evidence and yard counts may be stale",
      );
    // This attempt's pace is measured from now, not across the retry delay.
    const resumed = ByotCursor.checkpoint({
      ...failed,
      paceFrom: { at: now, sent: byotRequestsSent(failed) },
    });
    return resumed.ok
      ? { kind: "resume", cursor: resumed.value }
      : fresh(`its checkpoint did not reseal (${resumed.error.message})`);
  },
} as const;
