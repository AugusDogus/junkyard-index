import { Effect, Scope } from "effect";
import { and, eq, gte } from "drizzle-orm";
import { db } from "~/lib/db";
import { env } from "~/env";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import {
  determineHealthySources,
  shouldAdvanceMissingState,
  type PipelineSourceOutcome,
  type PipelineSourceName,
} from "./pipeline-policy";
import { streamPypInventory } from "./pyp-connector";
import {
  buildFinalInventoryByVin,
  reconcileFromFinalInventory,
} from "./reconcile";
import { streamRow52Inventory } from "./row52-connector";
import {
  PersistenceError,
  HeartbeatError,
  ReconcileError,
} from "./errors";
import { Config } from "./runtime";
import type { CanonicalVehicle } from "./types";

const RUN_LOCK_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const MISSING_DELETE_AFTER_RUNS = 3;
const MISSING_DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const SOURCE_CHUNK_PAGES = 10;

const EMPTY_TIMINGS = {
  sourcesParallelMs: 0,
  row52FetchMs: 0,
  pypFetchMs: 0,
  upsertFlushMs: 0,
  staleDeleteMs: 0,
  algoliaPrepMs: 0,
  algoliaSyncMs: 0,
};

type SourceName = PipelineSourceName;
type SourceOutcome = PipelineSourceOutcome;

export interface IngestionPipelineResult {
  totalUpserted: number;
  totalDeleted: number;
  pypCount: number;
  row52Count: number;
  errors: string[];
  durationMs: number;
  timingsMs: {
    sourcesParallelMs: number;
    row52FetchMs: number;
    pypFetchMs: number;
    upsertFlushMs: number;
    staleDeleteMs: number;
    algoliaPrepMs: number;
    algoliaSyncMs: number;
  };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function logMemoryUsage(
  stage: string,
  details: Record<string, number | string>,
): void {
  const usage = process.memoryUsage();
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(
    `[Ingestion] Memory ${stage}: rss=${formatMegabytes(usage.rss)} heap_used=${formatMegabytes(usage.heapUsed)} heap_total=${formatMegabytes(usage.heapTotal)} external=${formatMegabytes(usage.external)} ${detailText}`.trim(),
  );
}

function accumulateVehicles(
  target: Map<string, CanonicalVehicle>,
  vehicles: CanonicalVehicle[],
): void {
  for (const vehicle of vehicles) {
    target.set(vehicle.vin, vehicle);
  }
}

function sourceRunId(runId: string, source: SourceName): string {
  return `${runId}:${source}`;
}

const acquireLock = (
  runId: string,
  runTimestamp: Date,
): Effect.Effect<boolean, PersistenceError> =>
  Effect.tryPromise({
    try: () => {
      const lockCutoff = new Date(
        runTimestamp.getTime() - RUN_LOCK_TIMEOUT_MS,
      );
      return db.transaction(async (tx) => {
        const [activeRun] = await tx
          .select({ id: ingestionRun.id })
          .from(ingestionRun)
          .where(
            and(
              eq(ingestionRun.status, "running"),
              gte(ingestionRun.startedAt, lockCutoff),
            ),
          )
          .limit(1);

        if (activeRun) return false;

        await tx.insert(ingestionRun).values({
          id: runId,
          source: "all",
          status: "running",
          startedAt: runTimestamp,
        });
        return true;
      });
    },
    catch: (cause) =>
      new PersistenceError({ operation: "acquireLock", cause }),
  });

const initSourceRun = (
  runId: string,
  source: SourceName,
  startedAt: Date,
): Effect.Effect<void, PersistenceError> =>
  Effect.tryPromise({
    try: () =>
      db.insert(ingestionSourceRun).values({
        id: sourceRunId(runId, source),
        runId,
        source,
        status: "running",
        startCursor: source === "pyp" ? "1" : "0",
        nextCursor: source === "pyp" ? "1" : "0",
        pagesProcessed: 0,
        vehiclesProcessed: 0,
        startedAt,
      }),
    catch: (cause) =>
      new PersistenceError({ operation: `initSourceRun:${source}`, cause }),
  }).pipe(Effect.asVoid);

const updateSourceRunProgress = (params: {
  runId: string;
  source: SourceName;
  nextCursor: string;
  pagesProcessed: number;
  vehiclesProcessed: number;
}): Effect.Effect<void, PersistenceError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(ingestionSourceRun)
        .set({
          nextCursor: params.nextCursor,
          pagesProcessed: params.pagesProcessed,
          vehiclesProcessed: params.vehiclesProcessed,
        })
        .where(
          eq(
            ingestionSourceRun.id,
            sourceRunId(params.runId, params.source),
          ),
        ),
    catch: (cause) =>
      new PersistenceError({
        operation: `updateSourceRunProgress:${params.source}`,
        cause,
      }),
  }).pipe(Effect.asVoid);

const completeSourceRun = (params: {
  runId: string;
  source: SourceName;
  nextCursor: string;
  pagesProcessed: number;
  vehiclesProcessed: number;
  errors: string[];
}): Effect.Effect<void, PersistenceError> =>
  Effect.tryPromise({
    try: () => {
      const status =
        params.errors.length === 0
          ? "success"
          : params.vehiclesProcessed > 0
            ? "partial"
            : "error";
      return db
        .update(ingestionSourceRun)
        .set({
          status,
          nextCursor: params.nextCursor,
          pagesProcessed: params.pagesProcessed,
          vehiclesProcessed: params.vehiclesProcessed,
          errors:
            params.errors.length > 0
              ? JSON.stringify(params.errors)
              : null,
          completedAt: new Date(),
        })
        .where(
          eq(
            ingestionSourceRun.id,
            sourceRunId(params.runId, params.source),
          ),
        );
    },
    catch: (cause) =>
      new PersistenceError({
        operation: `completeSourceRun:${params.source}`,
        cause,
      }),
  }).pipe(Effect.asVoid);

const markRunComplete = (
  runId: string,
  status: "success" | "error",
  allErrors: string[],
  vehiclesUpserted?: number,
  vehiclesDeleted?: number,
): Effect.Effect<void, PersistenceError> =>
  Effect.tryPromise({
    try: () =>
      db
        .update(ingestionRun)
        .set({
          status,
          vehiclesUpserted: vehiclesUpserted ?? 0,
          vehiclesDeleted: vehiclesDeleted ?? 0,
          errors: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
          completedAt: new Date(),
        })
        .where(eq(ingestionRun.id, runId)),
    catch: (cause) =>
      new PersistenceError({ operation: "markRunComplete", cause }),
  }).pipe(Effect.asVoid);

const sendHeartbeat = (
  url: string,
  fail: boolean,
): Effect.Effect<void, HeartbeatError> =>
  Effect.tryPromise({
    try: () =>
      fetch(fail ? `${url}/fail` : url, { method: "HEAD" }).then(
        () => undefined,
      ),
    catch: (cause) => new HeartbeatError({ cause }),
  });

function fetchRow52Source(
  runId: string,
  vehicleMap: Map<string, CanonicalVehicle>,
  otherMap: Map<string, CanonicalVehicle>,
): Effect.Effect<SourceOutcome & { fetchMs: number }, never> {
  return Effect.gen(function* () {
    const startedAt = Date.now();

    const result = yield* streamRow52Inventory({
      onBatch: (vehicles) => accumulateVehicles(vehicleMap, vehicles),
      pagesPerChunk: SOURCE_CHUNK_PAGES,
      onProgress: async (progress) => {
        await Effect.runPromise(
          updateSourceRunProgress({
            runId,
            source: "row52",
            nextCursor: String(progress.nextSkip),
            pagesProcessed: progress.pagesProcessed,
            vehiclesProcessed: progress.vehiclesProcessed,
          }).pipe(Effect.catchAll(() => Effect.void)),
        );
      },
    }).pipe(
      Effect.tap((result) =>
        completeSourceRun({
          runId,
          source: "row52",
          nextCursor: String(result.nextSkip),
          pagesProcessed: result.pagesProcessed,
          vehiclesProcessed: result.count,
          errors: result.errors,
        }).pipe(Effect.catchAll(() => Effect.void)),
      ),
      Effect.tap(() =>
        Effect.sync(() =>
          logMemoryUsage("after_row52_fetch", {
            row52Vins: vehicleMap.size,
            otherVins: otherMap.size,
          }),
        ),
      ),
      Effect.catchAll((error) => {
        const msg = `Row52 ingestion failed: ${error.message}`;
        return completeSourceRun({
          runId,
          source: "row52",
          nextCursor: "0",
          pagesProcessed: 0,
          vehiclesProcessed: 0,
          errors: [msg],
        }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.map(() => ({
            source: "row52" as const,
            count: 0,
            errors: [msg],
            nextSkip: 0,
            pagesProcessed: 0,
            done: true,
          })),
        );
      }),
    );

    return {
      source: "row52" as const,
      count: result.count,
      errors: result.errors,
      fetchMs: Date.now() - startedAt,
    };
  });
}

function fetchPypSource(
  runId: string,
  vehicleMap: Map<string, CanonicalVehicle>,
  otherMap: Map<string, CanonicalVehicle>,
): Effect.Effect<SourceOutcome & { fetchMs: number }, never, Scope.Scope | Config> {
  return Effect.gen(function* () {
    const startedAt = Date.now();

    const result = yield* streamPypInventory({
      onBatch: (vehicles) => accumulateVehicles(vehicleMap, vehicles),
      onProgress: async (progress) => {
        await Effect.runPromise(
          updateSourceRunProgress({
            runId,
            source: "pyp",
            nextCursor: String(progress.nextPage),
            pagesProcessed: progress.pagesProcessed,
            vehiclesProcessed: progress.vehiclesProcessed,
          }).pipe(Effect.catchAll(() => Effect.void)),
        );
      },
    }).pipe(
      Effect.tap((result) =>
        completeSourceRun({
          runId,
          source: "pyp",
          nextCursor: String(result.nextPage),
          pagesProcessed: result.pagesProcessed,
          vehiclesProcessed: result.count,
          errors: result.errors,
        }).pipe(Effect.catchAll(() => Effect.void)),
      ),
      Effect.tap(() =>
        Effect.sync(() =>
          logMemoryUsage("after_pyp_fetch", {
            pypVins: vehicleMap.size,
            otherVins: otherMap.size,
          }),
        ),
      ),
      Effect.catchAll((error) => {
        const msg = `PYP ingestion failed: ${error.message}`;
        return completeSourceRun({
          runId,
          source: "pyp",
          nextCursor: "1",
          pagesProcessed: 0,
          vehiclesProcessed: 0,
          errors: [msg],
        }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.map(() => ({
            source: "pyp" as const,
            count: 0,
            errors: [msg],
            nextPage: 1,
            pagesProcessed: 0,
            done: true,
          })),
        );
      }),
    );

    return {
      source: "pyp" as const,
      count: result.count,
      errors: result.errors,
      fetchMs: Date.now() - startedAt,
    };
  });
}

/**
 * Main ingestion pipeline as an Effect program.
 */
export const ingestionPipeline: Effect.Effect<
  IngestionPipelineResult,
  PersistenceError | ReconcileError | HeartbeatError,
  Scope.Scope | Config
> = Effect.gen(function* () {
  const startTime = Date.now();
  const runTimestamp = new Date();
  const runId = crypto.randomUUID();
  const allErrors: string[] = [];

  console.log(
    `[Ingestion] Starting run ${runId} at ${runTimestamp.toISOString()} (pipeline=effect)`,
  );

  const lockAcquired = yield* acquireLock(runId, runTimestamp);
  if (!lockAcquired) {
    const durationMs = Date.now() - startTime;
    const msg = `[Ingestion] Skipping run ${runId}: another ingestion run is already active`;
    console.warn(msg);
    return {
      totalUpserted: 0,
      totalDeleted: 0,
      pypCount: 0,
      row52Count: 0,
      errors: [msg],
      durationMs,
      timingsMs: EMPTY_TIMINGS,
    };
  }

  yield* Effect.all([
    initSourceRun(runId, "row52", runTimestamp),
    initSourceRun(runId, "pyp", runTimestamp),
  ]);

  const row52ByVin = new Map<string, CanonicalVehicle>();
  const pypByVin = new Map<string, CanonicalVehicle>();

  const sourcesStart = Date.now();

  const [row52Result, pypResult] = yield* Effect.all(
    [
      fetchRow52Source(runId, row52ByVin, pypByVin),
      fetchPypSource(runId, pypByVin, row52ByVin),
    ],
    { concurrency: 2 },
  );

  const sourcesParallelMs = Date.now() - sourcesStart;
  allErrors.push(...row52Result.errors, ...pypResult.errors);

  const sourceOutcomes: SourceOutcome[] = [row52Result, pypResult];
  const healthySources = determineHealthySources(sourceOutcomes);
  const reconcileTimestamp = new Date();

  logMemoryUsage("before_inventory_finalization", {
    row52Vins: row52ByVin.size,
    pypVins: pypByVin.size,
    healthySources: healthySources.join(",") || "none",
  });

  const finalInventoryByVin = buildFinalInventoryByVin({
    healthySources,
    row52ByVin,
    pypByVin,
  });
  const finalizedInventoryCount = finalInventoryByVin.size;

  logMemoryUsage("after_inventory_finalization", {
    finalVins: finalizedInventoryCount,
    row52Vins: row52ByVin.size,
    pypVins: pypByVin.size,
  });

  const reconcileResult = yield* Effect.tryPromise({
    try: () =>
      reconcileFromFinalInventory({
        runId,
        runTimestamp: reconcileTimestamp,
        finalInventoryByVin,
        allowAdvanceMissingState: shouldAdvanceMissingState(sourceOutcomes),
        missingDeleteAfterRuns: MISSING_DELETE_AFTER_RUNS,
        missingDeleteAfterMs: MISSING_DELETE_AFTER_MS,
      }),
    catch: (cause) => new ReconcileError({ cause }),
  });

  const upsertFlushMs =
    reconcileResult.timingsMs.readExistingMs +
    reconcileResult.timingsMs.planMs +
    reconcileResult.timingsMs.upsertWriteMs;
  const staleDeleteMs = reconcileResult.timingsMs.missingWriteMs;

  if (reconcileResult.skippedMissingAdvance) {
    console.warn(
      "[Ingestion] Skipping missing-state advancement and deletions because one or more sources errored",
    );
  }

  const durationMs = Date.now() - startTime;
  const timingsMs = {
    sourcesParallelMs,
    row52FetchMs: row52Result.fetchMs,
    pypFetchMs: pypResult.fetchMs,
    upsertFlushMs,
    staleDeleteMs,
    algoliaPrepMs: 0,
    algoliaSyncMs: 0,
  };

  yield* markRunComplete(
    runId,
    "success",
    allErrors,
    reconcileResult.upsertedCount,
    reconcileResult.deletedCount,
  );

  console.log(
    `[Ingestion] PYP: ${pypResult.count} vehicles, Row52: ${row52Result.count} vehicles`,
  );
  console.log(
    `[Ingestion] Finalized ${finalizedInventoryCount} canonical vehicles from healthy sources`,
  );
  console.log(
    `[Ingestion] Reconcile complete: ${reconcileResult.upsertedCount} upserted, ${reconcileResult.deletedCount} deleted, ${reconcileResult.missingUpdatedCount} marked missing`,
  );
  console.log(
    `[Ingestion] Source timings: row52=${row52Result.fetchMs}ms pyp=${pypResult.fetchMs}ms parallel_window=${sourcesParallelMs}ms`,
  );
  console.log(
    `[Ingestion] Stage timings: inventory_diff_upsert=${upsertFlushMs}ms missing_delete=${staleDeleteMs}ms algolia_prep=0ms algolia_sync=0ms`,
  );

  if (env.BETTERSTACK_HEARTBEAT_URL) {
    yield* sendHeartbeat(env.BETTERSTACK_HEARTBEAT_URL, false).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[Ingestion] BetterStack heartbeat failed: ${err.message}`,
          ),
        ),
      ),
    );
  }

  return {
    totalUpserted: reconcileResult.upsertedCount,
    totalDeleted: reconcileResult.deletedCount,
    pypCount: pypResult.count,
    row52Count: row52Result.count,
    errors: allErrors,
    durationMs,
    timingsMs,
  };
});

/**
 * Run the ingestion pipeline. This is the sole entry point for run.ts and Trigger tasks.
 */
export async function runIngestionPipeline(): Promise<IngestionPipelineResult> {
  return Effect.runPromise(
    ingestionPipeline.pipe(
      Effect.scoped,
      Effect.provide(Config.Live),
      Effect.catchAll((error) => {
        const msg = `Ingestion run failed: ${error.message}`;
        console.error(msg);

        if (env.BETTERSTACK_HEARTBEAT_URL) {
          sendHeartbeat(env.BETTERSTACK_HEARTBEAT_URL, true).pipe(
            Effect.catchAll((err) =>
              Effect.sync(() =>
                console.warn(
                  `[Ingestion] BetterStack heartbeat (fail) failed: ${err.message}`,
                ),
              ),
            ),
            Effect.runSync,
          );
        }

        return Effect.fail(error);
      }),
    ),
  );
}
