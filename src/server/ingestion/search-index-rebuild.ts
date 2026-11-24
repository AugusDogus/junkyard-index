import { asc, count, gt } from "drizzle-orm";
import { Effect } from "effect";
import { vehicle } from "~/schema";
import type { AlgoliaError } from "./algolia-error";
import { RecordCapacity } from "./algolia-record-capacity";
import {
  SearchIndexGenerations,
  type ActiveSearchIndexGeneration,
} from "./search-index-generation";
import type { SearchIndexListing } from "./search-index-writer";
import { SearchOutbox } from "./search-outbox";
import {
  deadLetterStatement,
  saveIsolating,
  truncate,
  type DeadLetter,
  type SearchProjectorContext,
} from "./search-projection-batch";
import { SearchProjectorCheckpoint } from "./search-projector-checkpoint";
import { SearchRebuildWait } from "./search-rebuild-wait";

/** Vehicles read and saved per request while loading a generation. */
const LOAD_BATCH_SIZE = 1_000;
/** Vehicles loaded per step: a full load takes about 45 steps. */
const LOAD_PER_STEP = 10_000;
/** A generation still loading after this long is discarded and restarted. */
export const GENERATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * The default Algolia record cap (free plan: 1M; ALGOLIA_RECORD_LIMIT sets
 * it). A rebuild briefly holds the live index and its new copy at once, so
 * it starts only when every index's records plus a full copy of `vehicle`
 * stay under the cap less its safety margin (RecordCapacity).
 */
export const SEARCH_RECORD_CAP = RecordCapacity.defaultLimit;

/**
 * One rebuild step's outcome, as part of the projector's step result.
 *
 * - rebuild_prepared: leftovers swept, the temporary index created and
 *   stamped, the snapshot horizon recorded.
 * - rebuild_loading: a load step; `loaded` once every vehicle is copied.
 * - rebuild_live: the copy replaced the live index; the projector replays
 *   changes after `snapshotChangeId`.
 * - rebuild_discarded: the generation could not go live (its copy vanished
 *   or was overwritten, or it aged out); a new one is requested.
 * - record_cap: the copy would exceed the plan's record cap; it waits,
 *   and the live index keeps receiving changes meanwhile.
 * - missing_live_index: there is no live index to copy settings from; it
 *   waits for the search-index migration to create one.
 * - move_unconfirmed: a move may have been issued but the live index does
 *   not carry the generation's marker. Never discarded: an operator checks.
 */
export type SearchIndexRebuildResult =
  | {
      status: "rebuild_prepared";
      generationId: string;
      snapshotChangeId: number;
      sweptIndices: number;
    }
  | {
      status: "rebuild_loading";
      generationId: string;
      recordsLoaded: number;
      deadLettered: number;
      loaded: boolean;
    }
  | {
      status: "rebuild_live";
      generationId: string;
      snapshotChangeId: number;
    }
  | { status: "rebuild_discarded"; generationId: string; reason: string }
  | {
      status: "record_cap";
      generationId: string;
      entries: number;
      vehicles: number;
      cap: number;
      /** ISO time. */
      retryAt: string;
    }
  | { status: "move_unconfirmed"; generationId: string; message: string }
  | {
      status: "missing_live_index";
      generationId: string;
      /** ISO time. */
      retryAt: string;
      message: string;
    }
  | { status: "stopped" };

type RebuildEffect = Effect.Effect<SearchIndexRebuildResult, AlgoliaError>;

function isLeftover(
  listing: SearchIndexListing,
  params: { indexName: string; keep: string; replicas: ReadonlySet<string> },
): boolean {
  if (listing.primary !== null || params.replicas.has(listing.name)) {
    return false;
  }
  if (listing.name === params.keep) return false;
  // Inline rebuild copies (vehicles__rebuild_<run>) and other generations'.
  return (
    listing.name.startsWith(`${params.indexName}__rebuild_`) ||
    listing.name.startsWith(`${params.indexName}__generation_`)
  );
}

/**
 * Deletes temporary indices no generation needs: ended generations' copies,
 * inline rebuild copies (no inline writer runs while the projector does)
 * and stray generation copies. Resolves the remaining listing.
 */
function sweep(
  context: SearchProjectorContext,
  keep: string,
): Effect.Effect<
  { remaining: SearchIndexListing[]; swept: number },
  AlgoliaError
> {
  return Effect.gen(function* () {
    const listing = yield* context.writer.listIndices();
    const replicas = new Set(
      listing
        .flatMap((index) => index.replicas)
        .map((name) => name.replace(/^virtual\((.*)\)$/, "$1")),
    );
    const leftovers = listing.filter((index) =>
      isLeftover(index, { indexName: context.indexName, keep, replicas }),
    );
    for (const leftover of leftovers) {
      yield* context.writer.deleteIndex(leftover.name);
    }
    const ended = yield* Effect.promise(() =>
      SearchIndexGenerations.endedWithTempIndex(
        context.database,
        context.environment,
      ),
    );
    for (const generation of ended) {
      // Deleted above, or never created: either way it is gone now.
      yield* Effect.promise(() =>
        SearchIndexGenerations.markTempIndexDeleted(context.database, {
          id: generation.id,
          now: context.now(),
        }),
      );
    }
    const deleted = new Set(leftovers.map((index) => index.name));
    return {
      remaining: listing.filter((index) => !deleted.has(index.name)),
      swept: leftovers.length,
    };
  });
}

function waitForLiveIndex(
  context: SearchProjectorContext,
  generation: Extract<ActiveSearchIndexGeneration, { status: "requested" }>,
): RebuildEffect {
  return Effect.gen(function* () {
    const wait = yield* Effect.promise(() =>
      SearchRebuildWait.record(context.database, {
        reason: "missing_live_index",
        now: context.now(),
      }),
    );
    return {
      status: "missing_live_index",
      generationId: generation.id,
      retryAt: wait.retryAt.toISOString(),
      message: `Search rebuild ${generation.id} did not start: the live index ${context.indexName} does not exist, so there are no settings to copy. Run the search-index migration once to create it with its settings (GET /api/cron/search-index-migration with the cron secret); the rebuild is tried again at ${wait.retryAt.toISOString()}.`,
    };
  });
}

/**
 * Records a record-cap wait. The requested generation is retried with
 * backoff, and the live index keeps receiving changes meanwhile.
 */
function overRecordCap(
  context: SearchProjectorContext,
  generation: ActiveSearchIndexGeneration,
  capacity: RecordCapacity,
  outcome: string,
): RebuildEffect {
  return Effect.gen(function* () {
    const wait = yield* Effect.promise(() =>
      SearchRebuildWait.record(context.database, {
        reason: "record_cap",
        now: context.now(),
      }),
    );
    console.error(
      `Search rebuild ${generation.id} ${outcome}: ${RecordCapacity.describe(capacity)} The live index is unchanged and keeps receiving changes; a rebuild stays requested and is tried again at ${wait.retryAt.toISOString()}. Delete unneeded indices or replicas, or raise the plan and ALGOLIA_RECORD_LIMIT (docs/runbooks/search-projector.md).`,
    );
    return {
      status: "record_cap",
      generationId: generation.id,
      entries: capacity.entries,
      vehicles: capacity.vehicles,
      cap: capacity.limit,
      retryAt: wait.retryAt.toISOString(),
    };
  });
}

function prepare(
  context: SearchProjectorContext,
  generation: Extract<ActiveSearchIndexGeneration, { status: "requested" }>,
): RebuildEffect {
  return Effect.gen(function* () {
    const tempIndexName = SearchIndexGenerations.tempIndexName(
      context.indexName,
      generation.id,
    );
    const { remaining, swept } = yield* sweep(context, tempIndexName);
    // No live index to copy settings from: a copy with default settings
    // would go live without facets, sort replicas or a schema version.
    if (!remaining.some((index) => index.name === context.indexName)) {
      return yield* waitForLiveIndex(context, generation);
    }
    const [counted] = yield* Effect.promise(() =>
      context.database.select({ vehicles: count() }).from(vehicle),
    );
    // Virtual replicas share their primary's records; this copy is cleared.
    const capacity = RecordCapacity.forCopy({
      listing: remaining,
      exclude: [tempIndexName],
      vehicles: counted?.vehicles ?? 0,
      limit: RecordCapacity.limit(),
    });
    if (capacity.kind === "over_cap") {
      return yield* overRecordCap(
        context,
        generation,
        capacity,
        "did not start",
      );
    }
    // Every change at or below the snapshot is in Turso before loading
    // reads it, so the copy covers them; replay starts after it.
    const snapshotChangeId = yield* Effect.promise(() =>
      SearchOutbox.horizon(context.database),
    );
    const source = yield* context.writer.prepareIndex({
      from: context.indexName,
      to: tempIndexName,
      generation: generation.id,
    });
    if (source === "missing_source") {
      return yield* waitForLiveIndex(context, generation);
    }
    yield* Effect.promise(() =>
      SearchRebuildWait.clear(context.database, context.now()),
    );
    const started = yield* Effect.promise(() =>
      SearchIndexGenerations.startLoading(context.database, {
        id: generation.id,
        tempIndexName,
        snapshotChangeId,
        now: context.now(),
      }),
    );
    if (!started) return { status: "stopped" };
    return {
      status: "rebuild_prepared",
      generationId: generation.id,
      snapshotChangeId,
      sweptIndices: swept,
    };
  });
}

function discard(
  context: SearchProjectorContext,
  generation: ActiveSearchIndexGeneration,
  reason: string,
): RebuildEffect {
  return Effect.gen(function* () {
    yield* Effect.promise(() =>
      context.client.batch(
        SearchIndexGenerations.discardStatements({
          generation,
          error: reason,
          now: context.now(),
        }),
        "write",
      ),
    );
    console.warn(
      `[Search] Discarded search index generation ${generation.id} (${generation.reason}): ${reason}. A new rebuild was requested; the live index is unchanged.`,
    );
    return {
      status: "rebuild_discarded",
      generationId: generation.id,
      reason,
    };
  });
}

/**
 * Algolia refused the copy over its record quota. Retrying the load fails
 * the same way, and a loading generation holds back changes to the live
 * index, so its copy is deleted (freeing the records) and it is discarded
 * into a requested rebuild that waits on the record cap.
 */
function refusedOverQuota(
  context: SearchProjectorContext,
  generation: Extract<ActiveSearchIndexGeneration, { status: "loading" }>,
  error: AlgoliaError,
): RebuildEffect {
  return Effect.gen(function* () {
    // Free the records first, so a failed count below cannot keep the copy.
    yield* context.writer.deleteIndex(generation.tempIndexName);
    const listing = yield* context.writer.listIndices();
    const [counted] = yield* Effect.promise(() =>
      context.database.select({ vehicles: count() }).from(vehicle),
    );
    const capacity = RecordCapacity.forCopy({
      listing,
      exclude: [generation.tempIndexName],
      vehicles: counted?.vehicles ?? 0,
      limit: RecordCapacity.limit(),
    });
    yield* discard(
      context,
      generation,
      `Algolia refused its copy over the record quota (${error.detail})`,
    );
    return yield* overRecordCap(
      context,
      generation,
      // The copy was refused, so it did not fit whatever the counts say.
      { ...capacity, kind: "over_cap" },
      "stopped loading",
    );
  });
}

function load(
  context: SearchProjectorContext,
  generation: Extract<ActiveSearchIndexGeneration, { status: "loading" }>,
): RebuildEffect {
  return loadBatches(context, generation).pipe(
    Effect.catchTag("QuotaExceeded", (error) =>
      refusedOverQuota(context, generation, error),
    ),
  );
}

function loadBatches(
  context: SearchProjectorContext,
  generation: Extract<ActiveSearchIndexGeneration, { status: "loading" }>,
): RebuildEffect {
  return Effect.gen(function* () {
    if (
      context.now().getTime() - generation.startedAt.getTime() >
      GENERATION_MAX_AGE_MS
    ) {
      return yield* discard(
        context,
        generation,
        "still loading after 24 hours",
      );
    }
    // The copy must still be this generation's: a cheap settings read.
    const marker = yield* context.writer
      .metadata(generation.tempIndexName)
      .pipe(
        Effect.map((metadata) => metadata.generation),
        Effect.catchTag("NotFound", () => Effect.succeed(null)),
      );
    if (marker !== generation.id) {
      return yield* discard(
        context,
        generation,
        marker === null
          ? `its temporary index ${generation.tempIndexName} is gone`
          : `its temporary index ${generation.tempIndexName} carries generation ${marker}`,
      );
    }
    let cursor = generation.vinCursor;
    let loadedThisStep = 0;
    let deadLettered = 0;
    while (true) {
      const after = cursor;
      const rows = yield* Effect.promise(() =>
        context.database
          .select()
          .from(vehicle)
          .where(after === null ? undefined : gt(vehicle.vin, after))
          .orderBy(asc(vehicle.vin))
          .limit(LOAD_BATCH_SIZE),
      );
      // A projection failure fails the step; the load resumes from the
      // cursor when it is retried.
      const records = yield* Effect.promise(() => context.project(rows));
      const saved = yield* saveIsolating(
        context.writer,
        generation.tempIndexName,
        records,
      );
      const deadLetters: DeadLetter[] = saved.rejected.map(
        ({ record, error }) => ({
          changeId: generation.snapshotChangeId,
          vin: record.objectID,
          tag: error._tag,
          detail: truncate(error.message),
        }),
      );
      const finalTask = saved.taskIds.at(-1);
      if (finalTask !== undefined) {
        yield* context.writer.waitForTask(generation.tempIndexName, finalTask);
      }
      const done = rows.length < LOAD_BATCH_SIZE;
      const next = rows.at(-1)?.vin ?? after;
      const now = context.now();
      if (deadLetters.length > 0) {
        yield* Effect.promise(() =>
          context.client.batch(
            deadLetters.map((letter) =>
              deadLetterStatement({
                letter,
                environment: context.environment,
                indexName: generation.tempIndexName,
                now,
                // Written before the cursor moves: a retried batch may
                // record a rejection twice, but never loses one.
                guard: { sql: "1 = 1", args: [] },
              }),
            ),
            "write",
          ),
        );
      }
      const recorded = yield* Effect.promise(() =>
        SearchIndexGenerations.recordLoad(context.database, {
          id: generation.id,
          from: after,
          to: next,
          records: records.length - saved.rejected.length,
          done,
          now,
        }),
      );
      if (!recorded) return { status: "stopped" };
      cursor = next;
      loadedThisStep += rows.length;
      deadLettered += deadLetters.length;
      if (done || loadedThisStep >= LOAD_PER_STEP) {
        return {
          status: "rebuild_loading",
          generationId: generation.id,
          recordsLoaded:
            generation.recordsLoaded + loadedThisStep - deadLettered,
          deadLettered,
          loaded: done,
        };
      }
    }
  });
}

function goLive(
  context: SearchProjectorContext,
  generation: Extract<ActiveSearchIndexGeneration, { status: "moving" }>,
): RebuildEffect {
  return Effect.gen(function* () {
    const now = context.now();
    yield* Effect.promise(() =>
      SearchProjectorCheckpoint.ensure(context.database, now),
    );
    yield* Effect.promise(() =>
      context.client.batch(
        [
          ...SearchIndexGenerations.goLiveStatements({
            id: generation.id,
            environment: context.environment,
            now,
          }),
          SearchProjectorCheckpoint.jumpStatement({
            through: generation.snapshotChangeId,
            now,
          }),
        ],
        "write",
      ),
    );
    return {
      status: "rebuild_live",
      generationId: generation.id,
      snapshotChangeId: generation.snapshotChangeId,
    };
  });
}

/** The live index's generation marker; null when it has none or is missing. */
function liveGeneration(
  context: SearchProjectorContext,
): Effect.Effect<string | null, AlgoliaError> {
  return context.writer.metadata(context.indexName).pipe(
    Effect.map((metadata) => metadata.generation),
    Effect.catchTag("NotFound", () => Effect.succeed(null)),
  );
}

function move(
  context: SearchProjectorContext,
  generation: Extract<ActiveSearchIndexGeneration, { status: "moving" }>,
): RebuildEffect {
  return Effect.gen(function* () {
    if ((yield* liveGeneration(context)) === generation.id) {
      return yield* goLive(context, generation);
    }
    let taskId = generation.moveTaskId;
    if (taskId === null) {
      const marker = yield* context.writer
        .metadata(generation.tempIndexName)
        .pipe(
          Effect.map((metadata) => metadata.generation),
          Effect.catchTag("NotFound", () => Effect.succeed(null)),
        );
      if (marker !== generation.id) {
        return {
          status: "move_unconfirmed",
          generationId: generation.id,
          message: `Search index generation ${generation.id} is moving, but its temporary index ${generation.tempIndexName} ${marker === null ? "is gone" : `carries generation ${marker}`} and the live index ${context.indexName} does not carry it either. A move may have been issued without its task being recorded. The generation is kept; check the live index's userData (junkyardIndexGeneration) in the Algolia dashboard, then mark the generation discarded in search_index_generation to let a new rebuild start.`,
        };
      }
      const issued = yield* context.writer.moveIndex(
        generation.tempIndexName,
        context.indexName,
      );
      const recorded = yield* Effect.promise(() =>
        SearchIndexGenerations.recordMoveTask(context.database, {
          id: generation.id,
          taskId: issued,
          now: context.now(),
        }),
      );
      if (!recorded) return { status: "stopped" };
      taskId = issued;
    }
    yield* context.writer.waitForTask(generation.tempIndexName, taskId);
    if ((yield* liveGeneration(context)) === generation.id) {
      return yield* goLive(context, generation);
    }
    return {
      status: "move_unconfirmed",
      generationId: generation.id,
      message: `Search index generation ${generation.id}'s move task ${taskId} finished, but the live index ${context.indexName} does not carry its marker. The generation is kept and retried at the next step; if this persists, check the live index's userData in the Algolia dashboard.`,
    };
  });
}

/**
 * Full rebuilds of the search index, owned by the search projector. A
 * generation copies the live index's settings into a temporary index,
 * records the outbox horizon as its snapshot, loads every vehicle in VIN
 * order (resumable from its cursor), then moves the copy over the live
 * index. Once live, the projector's cursor jumps to the snapshot and replays
 * the changes after it. At most one generation is in flight per environment,
 * and leftovers are deleted before a copy starts, so the app never holds
 * more than the live index and one copy.
 */
export const SearchIndexRebuild = {
  /** Advances the in-flight generation by one step. */
  advance(
    context: SearchProjectorContext,
    generation: ActiveSearchIndexGeneration,
  ): RebuildEffect {
    switch (generation.status) {
      case "requested":
        return prepare(context, generation);
      case "loading":
        return load(context, generation);
      case "moving":
        return move(context, generation);
    }
  },
} as const;
