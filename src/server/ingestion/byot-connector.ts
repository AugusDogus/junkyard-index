import { Effect } from "effect";
import { BYOT_YARDS } from "./byot-configuration";
import { ByotCursor, byotQueryKey, BYOT_MAX_RUN_MS } from "./byot-cursor";
import {
  BYOT_ARRIVALS_URL,
  BYOT_DAILY_QUERIES,
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
import { readByotPage } from "./byot-client";
import type { CanonicalVehicle } from "./types";
import type { Yard } from "~/lib/yard";
import type { ConnectorChunkResult } from "./connector-chunk";

const unwrap = <T>(result: Result<T>) =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
export interface ByotOptions<E, R> {
  startCursor?: unknown;
  /** Only the prior accepted, search-published terminal cursor can seed a new run. */
  previousCursor?: ByotCursor | null;
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
    const budget = options.maxPages ?? 8;
    if (!Number.isInteger(budget) || budget < 1 || budget > 8)
      return yield* Effect.fail(
        ByotResult.error("request budget", "Use an integer from 1 to 8"),
      );
    let cursor = yield* unwrap(
      ByotCursor.parse(options.startCursor ?? ByotCursor.initial()),
    );
    if (cursor.phase === "initial") {
      const previous = options.previousCursor
        ? yield* unwrap(ByotCursor.parse(options.previousCursor))
        : null;
      cursor = yield* unwrap(
        ByotCursor.begin(previous, options.now ?? Date.now()),
      );
    }
    if (
      "startedAt" in cursor &&
      (options.now ?? Date.now()) - cursor.startedAt > BYOT_MAX_RUN_MS
    )
      return yield* Effect.fail(
        ByotResult.error(
          "daily run deadline",
          "Two-hour limit exceeded; restart from the prior published sweep checkpoint",
        ),
      );
    let pagesProcessed = 0;
    while (
      cursor.phase !== "ready" &&
      cursor.phase !== "complete" &&
      pagesProcessed < budget
    ) {
      if (cursor.phase === "initial")
        return yield* Effect.fail(
          ByotResult.error("checkpoint", "Run did not initialize"),
        );
      if (cursor.phase === "arrivals") {
        const yard = BYOT_YARDS[cursor.feeds.length];
        if (!yard)
          return yield* Effect.fail(
            ByotResult.error(
              "yard control",
              "Arrival index is outside the native location list",
            ),
          );
        const raw = yield* options.readPage(BYOT_ARRIVALS_URL, yard.code);
        const records = yield* unwrap(
          parseByotResponse(raw, "arrivals", yard.code),
        );
        const feeds = [...cursor.feeds, records];
        cursor = yield* unwrap(
          ByotCursor.checkpoint(
            feeds.length === BYOT_YARDS.length
              ? { ...cursor, phase: "search", feeds, progress: 0 }
              : { ...cursor, feeds },
          ),
        );
      } else {
        const yardIndex = cursor.progress % BYOT_YARDS.length;
        const yard = BYOT_YARDS[yardIndex];
        if (!yard)
          return yield* Effect.fail(
            ByotResult.error(
              "yard control",
              "Search index is outside the native location list",
            ),
          );
        const index =
          (cursor.sweepStart +
            Math.floor(cursor.progress / BYOT_YARDS.length)) %
          BYOT_QUERIES.length;
        const raw = yield* options.readPage(
          byotSearchUrl(yard.code, index),
          yard.code,
        );
        const records = yield* unwrap(
          parseByotResponse(raw, "search", `${yard.code} query ${index}`),
        );
        const startedAt = cursor.startedAt;
        const query = byotQueryKey(index);
        const cache = cursor.cache.map((entries, i) =>
          i === yardIndex
            ? [
                ...entries.filter((entry) => entry.query !== query),
                { query, checkedAt: startedAt, records },
              ]
            : entries,
        );
        const { progress: priorProgress, ...state } = cursor;
        const progress = priorProgress + 1;
        cursor = yield* unwrap(
          ByotCursor.checkpoint(
            progress === BYOT_DAILY_QUERIES * BYOT_YARDS.length
              ? { ...state, phase: "ready", cache }
              : { ...state, phase: "search", cache, progress },
          ),
        );
      }
      pagesProcessed++;
    }
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
        nextOffset:
          (cursor.sweepStart + BYOT_DAILY_QUERIES) % BYOT_QUERIES.length,
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
      duration: "4 minutes",
      onTimeout: () =>
        ByotResult.error("chunk deadline", "Four-minute limit exceeded"),
    }),
  );
}
export function streamByotInventoryFromProvider<E, R>(
  options: Omit<ByotOptions<E, R>, "readPage">,
) {
  return streamByotInventory({ ...options, readPage: readByotPage });
}
