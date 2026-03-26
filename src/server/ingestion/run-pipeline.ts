import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Duration, Effect, Scope } from "effect";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL } from "./constants";
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
import { streamAutorecyclerInventory } from "./autorecycler-connector";
import { streamRow52Inventory } from "./row52-connector";
import {
  PersistenceError,
  HeartbeatError,
  ReconcileError,
} from "./errors";
import { Config, Database, runIngestionEffect } from "./runtime";
import type { CanonicalVehicle } from "./types";

const RUN_LOCK_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const MISSING_DELETE_AFTER_RUNS = 3;
const MISSING_DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const SOURCE_CHUNK_PAGES = DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL;
const HEARTBEAT_TIMEOUT_MS = 5_000;

const EMPTY_TIMINGS = {
  sourcesParallelMs: 0,
  row52FetchMs: 0,
  pypFetchMs: 0,
  autorecyclerFetchMs: 0,
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
  autorecyclerCount: number;
  errors: string[];
  durationMs: number;
  timingsMs: {
    sourcesParallelMs: number;
    row52FetchMs: number;
    pypFetchMs: number;
    autorecyclerFetchMs: number;
    upsertFlushMs: number;
    staleDeleteMs: number;
    algoliaPrepMs: number;
    algoliaSyncMs: number;
  };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatMemoryUsage(
  stage: string,
  details: Record<string, number | string>,
): string {
  const usage = process.memoryUsage();
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `[Ingestion] Memory ${stage}: rss=${formatMegabytes(usage.rss)} heap_used=${formatMegabytes(usage.heapUsed)} heap_total=${formatMegabytes(usage.heapTotal)} external=${formatMegabytes(usage.external)} ${detailText}`.trim();
}

function accumulateVehicles(
  target: Map<string, CanonicalVehicle>,
  vehicles: CanonicalVehicle[],
): void {
  for (const vehicle of vehicles) {
    target.set(vehicle.vin, vehicle);
  }
}

/** Distinct VIN count across two maps (Row52 + PYP) while sources run in parallel. */
function uniqueVinCountAcrossMaps(
  a: Map<string, CanonicalVehicle>,
  b: Map<string, CanonicalVehicle>,
): number {
  let n = a.size;
  for (const k of b.keys()) {
    if (!a.has(k)) n += 1;
  }
  return n;
}

function sourceRunId(runId: string, source: SourceName): string {
  return `${runId}:${source}`;
}

const acquireLock = (
  runId: string,
  runTimestamp: Date,
): Effect.Effect<boolean, PersistenceError> =>
  Effect.tryPromise({
    try: async () => {
      const lockCutoff = new Date(
        runTimestamp.getTime() - RUN_LOCK_TIMEOUT_MS,
      );

      const result = await db.run(sql`
        insert into ingestion_run (id, source, status, started_at)
        select ${runId}, 'all', 'running', ${runTimestamp.getTime()}
        where not exists (
          select 1
          from ingestion_run
          where status = 'running'
            and started_at >= ${lockCutoff.getTime()}
        )
      `);

      return (result.rowsAffected ?? 0) > 0;
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

function parseSourceErrors(errorsJson: string | null): string[] {
  if (!errorsJson) return [];
  try {
    const parsed: unknown = JSON.parse(errorsJson);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function isSourceName(value: string): value is SourceName {
  return value === "row52" || value === "pyp" || value === "autorecycler";
}

const finalizePendingSourceRuns = (
  runId: string,
  failureMessage: string,
): Effect.Effect<void, PersistenceError> =>
  Effect.gen(function* () {
    const pendingSourceRuns = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            source: ingestionSourceRun.source,
            nextCursor: ingestionSourceRun.nextCursor,
            pagesProcessed: ingestionSourceRun.pagesProcessed,
            vehiclesProcessed: ingestionSourceRun.vehiclesProcessed,
            errors: ingestionSourceRun.errors,
          })
          .from(ingestionSourceRun)
          .where(
            and(
              eq(ingestionSourceRun.runId, runId),
              eq(ingestionSourceRun.status, "running"),
            ),
          ),
      catch: (cause) =>
        new PersistenceError({ operation: "finalizePendingSourceRuns.read", cause }),
    });

    for (const sourceRun of pendingSourceRuns) {
      if (!isSourceName(sourceRun.source)) {
        continue;
      }

      const existingErrors = parseSourceErrors(sourceRun.errors);
      yield* completeSourceRun({
        runId,
        source: sourceRun.source,
        nextCursor:
          sourceRun.nextCursor ?? (sourceRun.source === "pyp" ? "1" : "0"),
        pagesProcessed: sourceRun.pagesProcessed,
        vehiclesProcessed: sourceRun.vehiclesProcessed,
        errors: [...existingErrors, failureMessage],
      }).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            `[Ingestion] Failed to finalize source run ${sourceRun.source} for ${runId}: ${error.message}`,
          ),
        ),
      );
    }
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
): Effect.Effect<void, HeartbeatError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.head(fail ? `${url}/fail` : url);

    const response = yield* client.execute(request).pipe(
      Effect.raceFirst(
        Effect.sleep(Duration.millis(HEARTBEAT_TIMEOUT_MS)).pipe(
          Effect.flatMap(() =>
            Effect.fail(
              new Error(`Heartbeat timed out after ${HEARTBEAT_TIMEOUT_MS}ms`),
            ),
          ),
        ),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new Error(`Heartbeat responded with HTTP ${response.status}`),
      );
    }
  }).pipe(
    Effect.mapError((cause) => new HeartbeatError({ cause })),
    Effect.asVoid,
  );

function fetchRow52Source(
  runId: string,
  vehicleMap: Map<string, CanonicalVehicle>,
  otherMap: Map<string, CanonicalVehicle>,
): Effect.Effect<
  SourceOutcome & { fetchMs: number },
  PersistenceError,
  HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    let latestNextCursor = "0";
    let latestPagesProcessed = 0;
    let latestVehiclesProcessed = 0;

    const reportProgress = (progress: {
      nextSkip: number;
      pagesProcessed: number;
      vehiclesProcessed: number;
    }) => {
      latestNextCursor = String(progress.nextSkip);
      latestPagesProcessed = progress.pagesProcessed;
      latestVehiclesProcessed = progress.vehiclesProcessed;
      return updateSourceRunProgress({
        runId,
        source: "row52",
        nextCursor: String(progress.nextSkip),
        pagesProcessed: progress.pagesProcessed,
        vehiclesProcessed: progress.vehiclesProcessed,
      }).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            `[Ingestion] Row52 progress update failed: ${error.message}`,
          ),
        ),
      );
    };

    const result = yield* streamRow52Inventory({
      onBatch: (vehicles) =>
        Effect.sync(() => {
          accumulateVehicles(vehicleMap, vehicles);
        }),
      pagesPerChunk: SOURCE_CHUNK_PAGES,
      onProgress: reportProgress,
    }).pipe(
      Effect.tap((result) => {
        latestNextCursor = String(result.nextSkip);
        latestPagesProcessed = result.pagesProcessed;
        latestVehiclesProcessed = result.count;
        return completeSourceRun({
          runId,
          source: "row52",
          nextCursor: String(result.nextSkip),
          pagesProcessed: result.pagesProcessed,
          vehiclesProcessed: result.count,
          errors: result.errors,
        });
      }),
      Effect.tap(() =>
        Effect.logDebug(
          formatMemoryUsage("after_row52_fetch", {
            row52Vins: vehicleMap.size,
            otherVins: otherMap.size,
          }),
        ),
      ),
      Effect.catchAll((error) => {
        if (error instanceof PersistenceError) {
          return Effect.fail(error);
        }
        const msg = `Row52 ingestion failed: ${error.message}`;
        return completeSourceRun({
          runId,
          source: "row52",
          nextCursor: latestNextCursor,
          pagesProcessed: latestPagesProcessed,
          vehiclesProcessed: latestVehiclesProcessed,
          errors: [msg],
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `[Ingestion] completeSourceRun failed for source=row52 runId=${runId}: ${error.message}`,
            ),
          ),
          Effect.map(() => ({
            source: "row52" as const,
            count: latestVehiclesProcessed,
            errors: [msg],
            nextSkip: Number.parseInt(latestNextCursor, 10) || 0,
            pagesProcessed: latestPagesProcessed,
            done: false,
            fullyExhausted: false,
            stopped: true,
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
): Effect.Effect<
  SourceOutcome & { fetchMs: number },
  PersistenceError,
  Scope.Scope | Config
> {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    let latestNextCursor = "1";
    let latestPagesProcessed = 0;
    let latestVehiclesProcessed = 0;

    const reportProgress = (progress: {
      nextPage: number;
      pagesProcessed: number;
      vehiclesProcessed: number;
    }) => {
      latestNextCursor = String(progress.nextPage);
      latestPagesProcessed = progress.pagesProcessed;
      latestVehiclesProcessed = progress.vehiclesProcessed;
      return updateSourceRunProgress({
        runId,
        source: "pyp",
        nextCursor: String(progress.nextPage),
        pagesProcessed: progress.pagesProcessed,
        vehiclesProcessed: progress.vehiclesProcessed,
      }).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            `[Ingestion] PYP progress update failed: ${error.message}`,
          ),
        ),
      );
    };

    const result = yield* streamPypInventory({
      onBatch: (vehicles) =>
        Effect.sync(() => {
          accumulateVehicles(vehicleMap, vehicles);
        }),
      onProgress: reportProgress,
    }).pipe(
      Effect.tap((result) => {
        latestNextCursor = String(result.nextPage);
        latestPagesProcessed = result.pagesProcessed;
        latestVehiclesProcessed = result.count;
        return completeSourceRun({
          runId,
          source: "pyp",
          nextCursor: String(result.nextPage),
          pagesProcessed: result.pagesProcessed,
          vehiclesProcessed: result.count,
          errors: result.errors,
        });
      }),
      Effect.tap(() =>
        Effect.logDebug(
          formatMemoryUsage("after_pyp_fetch", {
            pypVins: vehicleMap.size,
            otherVins: otherMap.size,
          }),
        ),
      ),
      Effect.catchAll((error) => {
        if (error instanceof PersistenceError) {
          return Effect.fail(error);
        }
        const msg = `PYP ingestion failed: ${error.message}`;
        return completeSourceRun({
          runId,
          source: "pyp",
          nextCursor: latestNextCursor,
          pagesProcessed: latestPagesProcessed,
          vehiclesProcessed: latestVehiclesProcessed,
          errors: [msg],
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `[Ingestion] completeSourceRun failed for source=pyp runId=${runId}: ${error.message}`,
            ),
          ),
          Effect.map(() => ({
            source: "pyp" as const,
            count: latestVehiclesProcessed,
            errors: [msg],
            nextPage: Number.parseInt(latestNextCursor, 10) || 1,
            pagesProcessed: latestPagesProcessed,
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

function fetchAutorecyclerSource(
  runId: string,
  vehicleMap: Map<string, CanonicalVehicle>,
  peerMaps: {
    row52: Map<string, CanonicalVehicle>;
    pyp: Map<string, CanonicalVehicle>;
  },
): Effect.Effect<SourceOutcome & { fetchMs: number }, PersistenceError> {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    let latestNextCursor = "0";
    let latestPagesProcessed = 0;
    let latestVehiclesProcessed = 0;

    const reportProgress = (progress: {
      nextFrom: number;
      pagesProcessed: number;
      vehiclesProcessed: number;
    }) => {
      latestNextCursor = String(progress.nextFrom);
      latestPagesProcessed = progress.pagesProcessed;
      latestVehiclesProcessed = progress.vehiclesProcessed;
      return updateSourceRunProgress({
        runId,
        source: "autorecycler",
        nextCursor: String(progress.nextFrom),
        pagesProcessed: progress.pagesProcessed,
        vehiclesProcessed: progress.vehiclesProcessed,
      }).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            `[Ingestion] AutoRecycler progress update failed: ${error.message}`,
          ),
        ),
      );
    };

    const result = yield* streamAutorecyclerInventory({
      onBatch: (vehicles) =>
        Effect.sync(() => {
          accumulateVehicles(vehicleMap, vehicles);
        }),
      pagesPerChunk: SOURCE_CHUNK_PAGES,
      onProgress: (progress) =>
        reportProgress({
          nextFrom: progress.nextFrom,
          pagesProcessed: progress.pagesProcessed,
          vehiclesProcessed: progress.vehiclesProcessed,
        }),
    }).pipe(
      Effect.provideService(Database, db),
      Effect.tap((res) => {
        latestNextCursor = String(res.nextFrom);
        latestPagesProcessed = res.pagesProcessed;
        latestVehiclesProcessed = res.count;
        return Effect.logInfo(
          `[Ingestion] AutoRecycler geo_stats=${JSON.stringify(res.geoStats)}`,
        ).pipe(
          Effect.flatMap(() =>
            completeSourceRun({
              runId,
              source: "autorecycler",
              nextCursor: String(res.nextFrom),
              pagesProcessed: res.pagesProcessed,
              vehiclesProcessed: res.count,
              errors: res.errors,
            }),
          ),
        );
      }),
      Effect.tap(() =>
        Effect.logDebug(
          formatMemoryUsage("after_autorecycler_fetch", {
            autorecyclerVins: vehicleMap.size,
            otherVins: uniqueVinCountAcrossMaps(
              peerMaps.row52,
              peerMaps.pyp,
            ),
          }),
        ),
      ),
      Effect.catchAll((error) => {
        if (error instanceof PersistenceError) {
          return Effect.fail(error);
        }
        const msg = `AutoRecycler ingestion failed: ${error.message}`;
        return completeSourceRun({
          runId,
          source: "autorecycler",
          nextCursor: latestNextCursor,
          pagesProcessed: latestPagesProcessed,
          vehiclesProcessed: latestVehiclesProcessed,
          errors: [msg],
        }).pipe(
          Effect.catchAll((e) =>
            Effect.logWarning(
              `[Ingestion] completeSourceRun failed for source=autorecycler runId=${runId}: ${e.message}`,
            ),
          ),
          Effect.map(() => ({
            source: "autorecycler" as const,
            count: latestVehiclesProcessed,
            errors: [msg],
            pagesProcessed: latestPagesProcessed,
            nextFrom: Number.parseInt(latestNextCursor, 10) || 0,
            done: false,
            fullyExhausted: false,
            stopped: true,
            geoStats: {
              geoLookupCount: 0,
              geoHitMemory: 0,
              geoHitDb: 0,
              geoMissAfterFetch: 0,
            },
          })),
        );
      }),
    );

    return {
      source: "autorecycler" as const,
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
  Scope.Scope | Config | HttpClient.HttpClient
> = Effect.gen(function* () {
  const startTime = Date.now();
  const runTimestamp = new Date();
  const runId = crypto.randomUUID();
  const allErrors: string[] = [];
  const config = yield* Config;

  yield* Effect.logInfo(
    `[Ingestion] Starting run ${runId} at ${runTimestamp.toISOString()} (pipeline=effect)`,
  );

  const lockAcquired = yield* acquireLock(runId, runTimestamp);
  if (!lockAcquired) {
    const durationMs = Date.now() - startTime;
    const msg = `[Ingestion] Skipping run ${runId}: another ingestion run is already active`;
    yield* Effect.logWarning(msg);
    return {
      totalUpserted: 0,
      totalDeleted: 0,
      pypCount: 0,
      row52Count: 0,
      autorecyclerCount: 0,
      errors: [msg],
      durationMs,
      timingsMs: EMPTY_TIMINGS,
    };
  }

  const runWithLock = Effect.gen(function* () {
    yield* Effect.all([
      initSourceRun(runId, "row52", runTimestamp),
      initSourceRun(runId, "pyp", runTimestamp),
      initSourceRun(runId, "autorecycler", runTimestamp),
    ]);

    const row52ByVin = new Map<string, CanonicalVehicle>();
    const pypByVin = new Map<string, CanonicalVehicle>();
    const autorecyclerByVin = new Map<string, CanonicalVehicle>();

    const sourcesStart = Date.now();

    const [row52Result, pypResult, autorecyclerResult] = yield* Effect.all(
      [
        fetchRow52Source(runId, row52ByVin, pypByVin),
        fetchPypSource(runId, pypByVin, row52ByVin),
        fetchAutorecyclerSource(runId, autorecyclerByVin, {
          row52: row52ByVin,
          pyp: pypByVin,
        }),
      ],
      { concurrency: 3 },
    );

    const sourcesParallelMs = Date.now() - sourcesStart;
    allErrors.push(
      ...row52Result.errors,
      ...pypResult.errors,
      ...autorecyclerResult.errors,
    );

    const sourceOutcomes: SourceOutcome[] = [
      row52Result,
      pypResult,
      autorecyclerResult,
    ];
    const healthySources = determineHealthySources(sourceOutcomes);
    const reconcileTimestamp = new Date();

    yield* Effect.logDebug(
      formatMemoryUsage("before_inventory_finalization", {
        row52Vins: row52ByVin.size,
        pypVins: pypByVin.size,
        autorecyclerVins: autorecyclerByVin.size,
        healthySources: healthySources.join(",") || "none",
      }),
    );

    const finalInventoryByVin = buildFinalInventoryByVin({
      healthySources,
      row52ByVin,
      pypByVin,
      autorecyclerByVin,
    });
    const finalizedInventoryCount = finalInventoryByVin.size;

    yield* Effect.logDebug(
      formatMemoryUsage("after_inventory_finalization", {
        finalVins: finalizedInventoryCount,
        row52Vins: row52ByVin.size,
        pypVins: pypByVin.size,
        autorecyclerVins: autorecyclerByVin.size,
      }),
    );

    const reconcileResult = yield* reconcileFromFinalInventory({
      runId,
      runTimestamp: reconcileTimestamp,
      finalInventoryByVin,
      allowAdvanceMissingState: shouldAdvanceMissingState(sourceOutcomes),
      missingDeleteAfterRuns: MISSING_DELETE_AFTER_RUNS,
      missingDeleteAfterMs: MISSING_DELETE_AFTER_MS,
    }).pipe(
      Effect.provideService(Database, db),
      Effect.mapError((cause) => new ReconcileError({ cause })),
    );

    const upsertFlushMs =
      reconcileResult.timingsMs.readExistingMs +
      reconcileResult.timingsMs.planMs +
      reconcileResult.timingsMs.upsertWriteMs;
    const staleDeleteMs = reconcileResult.timingsMs.missingWriteMs;

    if (reconcileResult.skippedMissingAdvance) {
      yield* Effect.logWarning(
        "[Ingestion] Skipping missing-state advancement and deletions because one or more sources errored",
      );
    }

    const durationMs = Date.now() - startTime;
    const timingsMs = {
      sourcesParallelMs,
      row52FetchMs: row52Result.fetchMs,
      pypFetchMs: pypResult.fetchMs,
      autorecyclerFetchMs: autorecyclerResult.fetchMs,
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

    yield* Effect.logInfo(
      `[Ingestion] PYP: ${pypResult.count} vehicles, Row52: ${row52Result.count} vehicles, AutoRecycler: ${autorecyclerResult.count} vehicles`,
    );
    yield* Effect.logInfo(
      `[Ingestion] Finalized ${finalizedInventoryCount} canonical vehicles from healthy sources`,
    );
    yield* Effect.logInfo(
      `[Ingestion] Reconcile complete: ${reconcileResult.upsertedCount} upserted, ${reconcileResult.deletedCount} deleted, ${reconcileResult.missingUpdatedCount} marked missing`,
    );
    yield* Effect.logInfo(
      `[Ingestion] Source timings: row52=${row52Result.fetchMs}ms pyp=${pypResult.fetchMs}ms autorecycler=${autorecyclerResult.fetchMs}ms parallel_window=${sourcesParallelMs}ms`,
    );
    yield* Effect.logInfo(
      `[Ingestion] Stage timings: inventory_diff_upsert=${upsertFlushMs}ms missing_delete=${staleDeleteMs}ms algolia_prep=0ms algolia_sync=0ms`,
    );

    if (config.betterStackHeartbeatUrl) {
      yield* sendHeartbeat(config.betterStackHeartbeatUrl, false).pipe(
        Effect.catchAll((err) =>
          Effect.logWarning(
            `[Ingestion] BetterStack heartbeat failed: ${err.message}`,
          ),
        ),
      );
    }

    return {
      totalUpserted: reconcileResult.upsertedCount,
      totalDeleted: reconcileResult.deletedCount,
      pypCount: pypResult.count,
      row52Count: row52Result.count,
      autorecyclerCount: autorecyclerResult.count,
      errors: allErrors,
      durationMs,
      timingsMs,
    };
  });

  return yield* runWithLock.pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const msg = `Ingestion run failed: ${error.message}`;
        allErrors.push(msg);

        const finalizeError = yield* finalizePendingSourceRuns(runId, msg).pipe(
          Effect.match({
            onSuccess: () => null,
            onFailure: (finalizationFailure) => finalizationFailure,
          }),
        );
        if (finalizeError) {
          const finalizeMessage = `Failed to finalize source runs for ${runId}: ${finalizeError.message}`;
          allErrors.push(finalizeMessage);
          yield* Effect.logWarning(`[Ingestion] ${finalizeMessage}`);
        }

        const markError = yield* markRunComplete(runId, "error", allErrors).pipe(
          Effect.match({
            onSuccess: () => null,
            onFailure: (markFailure) => markFailure,
          }),
        );
        if (markError) {
          yield* Effect.logWarning(
            `[Ingestion] Failed to mark run ${runId} as error: ${markError.message}`,
          );
        }

        return yield* Effect.fail(error);
      }),
    ),
  );
});

/**
 * Run the ingestion pipeline. This is the sole entry point for run.ts and Trigger tasks.
 */
export async function runIngestionPipeline(): Promise<IngestionPipelineResult> {
  return runIngestionEffect(
    ingestionPipeline.pipe(
      Effect.scoped,
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const config = yield* Config;
          const msg = `Ingestion run failed: ${error.message}`;
          const reportFailureHeartbeat = config.betterStackHeartbeatUrl
            ? sendHeartbeat(config.betterStackHeartbeatUrl, true).pipe(
                Effect.catchAll((err) =>
                  Effect.logWarning(
                    `[Ingestion] BetterStack heartbeat (fail) failed: ${err.message}`,
                  ),
                ),
              )
            : Effect.void;

          yield* reportFailureHeartbeat;
          yield* Effect.logError(msg);
          return yield* Effect.fail(error);
        }),
      ),
    ),
  );
}
