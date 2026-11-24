import { Clock, Effect } from "effect";
import { BYOT_YARDS } from "./byot-configuration";
import {
  BYOT_CHUNK_REQUESTS,
  ByotCursor,
  byotQueryKey,
  BYOT_MAX_RUN_MS,
  BYOT_RUN_REQUESTS,
  byotRequestsSent,
  type ByotCursorState,
} from "./byot-cursor";
import {
  BYOT_ARRIVALS_URL,
  BYOT_QUERIES,
  byotSearchUrl,
} from "./byot-directory";
import {
  ByotResult,
  type ByotError,
  type ByotResult as Result,
} from "./byot-result";
import { parseByotResponse } from "./byot-parser";
import { byotSnapshot } from "./byot-snapshot";
import {
  BYOT_REQUEST_GAP_MS,
  BYOT_REQUEST_TIMEOUT_MS,
  readByotPage,
} from "./byot-client";
import type { CanonicalVehicle } from "./types";
import type { Yard } from "~/lib/yard";
import type { ConnectorChunkResult } from "./connector-chunk";

const unwrap = <T>(result: Result<T>) =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
export const BYOT_CHUNK_WORK_MS = 4 * 60_000;
/** Time the final chunk keeps for building, validating and emitting the
 * day's snapshot after its last search. */
const SNAPSHOT_RESERVE_MS = 20_000;
/** A chunk starts another request only while that request, at its full
 * deadline plus pacing gap, and the snapshot still fit in the chunk. */
const REQUEST_START_WINDOW_MS =
  BYOT_CHUNK_WORK_MS -
  BYOT_REQUEST_TIMEOUT_MS -
  BYOT_REQUEST_GAP_MS -
  SNAPSHOT_RESERVE_MS;
export interface ByotOptions<E, R> {
  startCursor?: unknown;
  /** Only the prior accepted, search-published terminal cursor can seed a new run. */
  previousCursor?: ByotCursor | null;
  /** The last checkpoint of the newest finished attempt, when it failed. A
   * new run continues it when `ByotCursor.resume` allows. */
  failedAttemptCursor?: string | null;
  now?: number;
  maxPages?: number;
  readPage: (url: string, code: string) => Effect.Effect<string, ByotError>;
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export interface ByotStreamResult extends Omit<
  ConnectorChunkResult<"byot", ByotCursor>,
  "status"
> {
  status: "paused" | "complete";
}

export function streamByotInventory<E, R>(
  options: ByotOptions<E, R>,
): Effect.Effect<ByotStreamResult, ByotError | E, R> {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? BYOT_CHUNK_REQUESTS;
    if (!Number.isInteger(budget) || budget < 1 || budget > BYOT_CHUNK_REQUESTS)
      return yield* Effect.fail(
        ByotResult.error(
          "request budget",
          `Received ${budget}; use an integer from 1 to ${BYOT_CHUNK_REQUESTS}. No request was sent`,
        ),
      );
    const chunkStartedAt = yield* Clock.currentTimeMillis;
    let cursor = yield* unwrap(
      ByotCursor.parse(options.startCursor ?? ByotCursor.initial()),
    );
    const now = options.now ?? Date.now();
    if (cursor.phase === "initial") {
      const previous = options.previousCursor
        ? yield* unwrap(ByotCursor.parse(options.previousCursor))
        : null;
      const resumption = options.failedAttemptCursor
        ? ByotCursor.resume(options.failedAttemptCursor, previous, now)
        : null;
      if (resumption?.kind === "fresh")
        yield* Effect.logWarning(resumption.reason);
      cursor =
        resumption?.kind === "resume"
          ? resumption.cursor
          : yield* unwrap(ByotCursor.begin(previous, now));
    }
    if ("startedAt" in cursor && now - cursor.startedAt > BYOT_MAX_RUN_MS)
      return yield* Effect.fail(
        ByotResult.error(
          "daily run deadline",
          `${BYOT_MAX_RUN_MS / 3_600_000}-hour limit exceeded, so this run's search evidence is too old to publish. Published inventory is unchanged; the next attempt starts a fresh sweep from the latest publication`,
        ),
      );
    if (
      (cursor.phase === "arrivals" || cursor.phase === "search") &&
      cursor.paceFrom !== undefined
    ) {
      // Fail before sending when this attempt's observed pace, chunk
      // transitions included, cannot finish the sweep inside the run limit.
      const sent = byotRequestsSent(cursor);
      const measured = sent - cursor.paceFrom.sent;
      const pace = (now - cursor.paceFrom.at) / Math.max(1, measured);
      const remaining = BYOT_RUN_REQUESTS - sent;
      const finish = now + remaining * pace;
      if (
        measured >= BYOT_CHUNK_REQUESTS &&
        finish - cursor.startedAt > BYOT_MAX_RUN_MS
      )
        return yield* Effect.fail(
          ByotResult.error(
            "daily run deadline",
            `At this attempt's observed ${(pace / 1_000).toFixed(1)} s per request, its ${remaining} remaining requests would end at about ${new Date(finish).toISOString()}, after the ${BYOT_MAX_RUN_MS / 3_600_000}-hour limit for evidence from ${new Date(cursor.startedAt).toISOString()}. No request was sent in this chunk; published inventory is unchanged and the checkpoint after ${sent} requests is kept. Check BYOT response times before the next attempt`,
          ),
        );
    }
    // Requests advance one working state, which the chunk seals and
    // validates once at the end. After a request has succeeded, a failed one
    // ends the chunk with the work before it, so a step retry does not resend
    // it; the next chunk sends the failed request first and fails if it fails
    // again.
    let state: ByotCursorState = cursor;
    let pagesProcessed = 0;
    const read = (
      url: string,
      code: string,
      kind: "arrivals" | "search",
      context: string,
    ) =>
      Effect.either(
        options
          .readPage(url, code)
          .pipe(
            Effect.flatMap((raw) =>
              unwrap(parseByotResponse(raw, kind, context)),
            ),
          ),
      );
    while (
      state.phase !== "ready" &&
      state.phase !== "complete" &&
      pagesProcessed < budget
    ) {
      if (
        pagesProcessed > 0 &&
        (yield* Clock.currentTimeMillis) - chunkStartedAt >
          REQUEST_START_WINDOW_MS
      )
        break;
      if (state.phase === "initial")
        return yield* Effect.fail(
          ByotResult.error("checkpoint", "Run did not initialize"),
        );
      if (state.phase === "arrivals") {
        const yard = BYOT_YARDS[state.feeds.length];
        if (!yard)
          return yield* Effect.fail(
            ByotResult.error(
              "yard control",
              "Arrival index is outside the native location list",
            ),
          );
        const fetched = yield* read(
          BYOT_ARRIVALS_URL,
          yard.code,
          "arrivals",
          yard.code,
        );
        if (fetched._tag === "Left") {
          if (pagesProcessed > 0) break;
          return yield* Effect.fail(fetched.left);
        }
        const records = fetched.right;
        const feeds = [...state.feeds, records];
        state =
          feeds.length === BYOT_YARDS.length
            ? { ...state, phase: "search", feeds, progress: 0 }
            : { ...state, feeds };
      } else {
        const yardIndex = state.progress % BYOT_YARDS.length;
        const yard = BYOT_YARDS[yardIndex];
        if (!yard)
          return yield* Effect.fail(
            ByotResult.error(
              "yard control",
              "Search index is outside the native location list",
            ),
          );
        const index =
          (state.sweepStart + Math.floor(state.progress / BYOT_YARDS.length)) %
          BYOT_QUERIES.length;
        const fetched = yield* read(
          byotSearchUrl(yard.code, index),
          yard.code,
          "search",
          `${yard.code} query ${index}`,
        );
        if (fetched._tag === "Left") {
          if (pagesProcessed > 0) break;
          return yield* Effect.fail(fetched.left);
        }
        const records = fetched.right;
        const startedAt = state.startedAt;
        const query = byotQueryKey(index);
        const cache = state.cache.map((entries, i) =>
          i === yardIndex
            ? [
                ...entries.filter((entry) => entry.query !== query),
                { query, checkedAt: startedAt, records },
              ]
            : entries,
        );
        const { progress: priorProgress, ...rest } = state;
        const progress = priorProgress + 1;
        state =
          progress === BYOT_QUERIES.length * BYOT_YARDS.length
            ? { ...rest, phase: "ready", cache }
            : { ...rest, phase: "search", cache, progress };
      }
      pagesProcessed++;
    }
    if (pagesProcessed > 0)
      cursor = yield* unwrap(ByotCursor.checkpoint(state));
    if (cursor.phase !== "ready")
      return {
        source: "byot",
        status: cursor.phase === "complete" ? "complete" : "paused",
        cursor,
        count: 0,
        pagesProcessed,
        errors: [],
        accounting: {
          recordsProcessed: 0,
          recordsRejected: 0,
          recordsExcluded: 0,
          duplicateVehicles: 0,
        },
      } satisfies ConnectorChunkResult<"byot", ByotCursor>;
    const snapshot = byotSnapshot(
      cursor.feeds,
      cursor.cache,
      cursor.previousCounts,
    );
    yield* unwrap(snapshot.validation);
    const complete = yield* unwrap(
      ByotCursor.checkpoint({
        source: "byot",
        version: 1,
        scope: cursor.scope,
        directory: cursor.directory,
        phase: "complete",
        // Evidence uses a stable run observation epoch, including resumed chunks.
        completedAt: cursor.startedAt,
        // A full sweep ends where it began.
        nextOffset: cursor.sweepStart,
        cache: cursor.cache,
        yardCounts: snapshot.yardCounts,
      }),
    );
    if (options.onYards)
      yield* options.onYards(BYOT_YARDS.map((yard) => ({ ...yard })));
    yield* options.onBatch(snapshot.vehicles);
    return {
      source: "byot",
      status: "complete",
      cursor: complete,
      count: snapshot.vehicles.length,
      pagesProcessed,
      errors: [],
      accounting: snapshot.accounting,
      observedVins: snapshot.observedVins,
    } satisfies ConnectorChunkResult<"byot", ByotCursor>;
  }).pipe(
    Effect.timeoutFail({
      duration: BYOT_CHUNK_WORK_MS,
      onTimeout: () =>
        ByotResult.error(
          "chunk deadline",
          `${BYOT_CHUNK_WORK_MS / 60_000}-minute chunk limit exceeded. Nothing from this chunk was kept; the input checkpoint and published inventory are unchanged, and a retry resumes from that checkpoint`,
        ),
    }),
  );
}
export function streamByotInventoryFromProvider<E, R>(
  options: Omit<ByotOptions<E, R>, "readPage">,
) {
  return streamByotInventory({ ...options, readPage: readByotPage });
}
