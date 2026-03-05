import { and, eq, gte } from "drizzle-orm";
import { env } from "~/env";
import { db } from "~/lib/db";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import {
  determineHealthySources,
  shouldAdvanceMissingState,
  type PipelineSourceOutcome,
  type PipelineSourceName,
} from "./pipeline-policy";
import { streamPypInventoryToSink } from "./pyp-connector";
import { reconcileFromSnapshotRun } from "./reconcile";
import { streamRow52InventoryToSink } from "./row52-connector";
import { createSnapshotSink } from "./snapshot-sink";

const RUN_LOCK_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const MISSING_DELETE_AFTER_RUNS = 3;
const MISSING_DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const SNAPSHOT_QUEUE_MAX_BATCHES = 64;
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

async function acquireIngestionLock(
  runId: string,
  runTimestamp: Date,
): Promise<boolean> {
  const lockCutoff = new Date(runTimestamp.getTime() - RUN_LOCK_TIMEOUT_MS);

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

    if (activeRun) {
      return false;
    }

    await tx.insert(ingestionRun).values({
      id: runId,
      source: "all",
      status: "running",
      startedAt: runTimestamp,
    });

    return true;
  });
}

function sourceRunId(runId: string, source: SourceName): string {
  return `${runId}:${source}`;
}

async function initSourceRun(
  runId: string,
  source: SourceName,
  startedAt: Date,
): Promise<void> {
  await db.insert(ingestionSourceRun).values({
    id: sourceRunId(runId, source),
    runId,
    source,
    status: "running",
    startCursor: source === "pyp" ? "1" : "0",
    nextCursor: source === "pyp" ? "1" : "0",
    pagesProcessed: 0,
    vehiclesProcessed: 0,
    startedAt,
  });
}

async function updateSourceRunProgress(params: {
  runId: string;
  source: SourceName;
  nextCursor: string;
  pagesProcessed: number;
  vehiclesProcessed: number;
}): Promise<void> {
  await db
    .update(ingestionSourceRun)
    .set({
      nextCursor: params.nextCursor,
      pagesProcessed: params.pagesProcessed,
      vehiclesProcessed: params.vehiclesProcessed,
    })
    .where(eq(ingestionSourceRun.id, sourceRunId(params.runId, params.source)));
}

async function completeSourceRun(params: {
  runId: string;
  source: SourceName;
  nextCursor: string;
  pagesProcessed: number;
  vehiclesProcessed: number;
  errors: string[];
}): Promise<void> {
  const status =
    params.errors.length === 0
      ? "success"
      : params.vehiclesProcessed > 0
        ? "partial"
        : "error";
  await db
    .update(ingestionSourceRun)
    .set({
      status,
      nextCursor: params.nextCursor,
      pagesProcessed: params.pagesProcessed,
      vehiclesProcessed: params.vehiclesProcessed,
      errors: params.errors.length > 0 ? JSON.stringify(params.errors) : null,
      completedAt: new Date(),
    })
    .where(eq(ingestionSourceRun.id, sourceRunId(params.runId, params.source)));
}

export async function runIngestionPipeline(): Promise<{
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
}> {
  const startTime = Date.now();
  const runTimestamp = new Date();
  const runId = crypto.randomUUID();
  const allErrors: string[] = [];

  console.log(
    `[Ingestion] Starting run ${runId} at ${runTimestamp.toISOString()} (pipeline=v2)`,
  );

  const lockAcquired = await acquireIngestionLock(runId, runTimestamp);
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

  try {
    await Promise.all([
      initSourceRun(runId, "row52", runTimestamp),
      initSourceRun(runId, "pyp", runTimestamp),
    ]);
    const snapshotSink = createSnapshotSink({
      runId,
      maxQueuedBatches: SNAPSHOT_QUEUE_MAX_BATCHES,
    });

    let row52FetchMs = 0;
    let pypFetchMs = 0;
    const sourcesStart = Date.now();

    const row52Promise = (async (): Promise<SourceOutcome> => {
      const startedAt = Date.now();
      try {
        const result = await streamRow52InventoryToSink({
          onBatch: async (vehicles) => {
            await snapshotSink.enqueue("row52", vehicles);
          },
          pagesPerChunk: SOURCE_CHUNK_PAGES,
          onProgress: async (progress) => {
            await updateSourceRunProgress({
              runId,
              source: "row52",
              nextCursor: String(progress.nextSkip),
              pagesProcessed: progress.pagesProcessed,
              vehiclesProcessed: progress.vehiclesProcessed,
            });
          },
        });

        await completeSourceRun({
          runId,
          source: "row52",
          nextCursor: String(result.nextSkip),
          pagesProcessed: result.pagesProcessed,
          vehiclesProcessed: result.count,
          errors: result.errors,
        });

        return {
          source: "row52",
          count: result.count,
          errors: result.errors,
        };
      } catch (error) {
        const msg = `Row52 ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
        await completeSourceRun({
          runId,
          source: "row52",
          nextCursor: "0",
          pagesProcessed: 0,
          vehiclesProcessed: 0,
          errors: [msg],
        });
        return { source: "row52", count: 0, errors: [msg] };
      } finally {
        row52FetchMs = Date.now() - startedAt;
      }
    })();

    const pypPromise = (async (): Promise<SourceOutcome> => {
      const startedAt = Date.now();
      try {
        const result = await streamPypInventoryToSink({
          onBatch: async (vehicles) => {
            await snapshotSink.enqueue("pyp", vehicles);
          },
          pagesPerChunk: SOURCE_CHUNK_PAGES,
          onProgress: async (progress) => {
            await updateSourceRunProgress({
              runId,
              source: "pyp",
              nextCursor: String(progress.nextPage),
              pagesProcessed: progress.pagesProcessed,
              vehiclesProcessed: progress.vehiclesProcessed,
            });
          },
        });

        await completeSourceRun({
          runId,
          source: "pyp",
          nextCursor: String(result.nextPage),
          pagesProcessed: result.pagesProcessed,
          vehiclesProcessed: result.count,
          errors: result.errors,
        });

        return {
          source: "pyp",
          count: result.count,
          errors: result.errors,
        };
      } catch (error) {
        const msg = `PYP ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
        await completeSourceRun({
          runId,
          source: "pyp",
          nextCursor: "1",
          pagesProcessed: 0,
          vehiclesProcessed: 0,
          errors: [msg],
        });
        return { source: "pyp", count: 0, errors: [msg] };
      } finally {
        pypFetchMs = Date.now() - startedAt;
      }
    })();

    const [row52Result, pypResult] = await Promise.all([row52Promise, pypPromise]);
    const sourcesParallelMs = Date.now() - sourcesStart;

    const flushStartedAt = Date.now();
    await snapshotSink.drain();
    const upsertFlushMs = Date.now() - flushStartedAt;

    allErrors.push(...row52Result.errors, ...pypResult.errors);

    const sourceOutcomes = [row52Result, pypResult];
    const healthySources = determineHealthySources(sourceOutcomes);

    const staleDeleteStartedAt = Date.now();
    const reconcileTimestamp = new Date();
    const reconcileResult = await reconcileFromSnapshotRun({
      runId,
      runTimestamp: reconcileTimestamp,
      healthySources,
      allowAdvanceMissingState: shouldAdvanceMissingState(sourceOutcomes),
      missingDeleteAfterRuns: MISSING_DELETE_AFTER_RUNS,
      missingDeleteAfterMs: MISSING_DELETE_AFTER_MS,
    });
    const staleDeleteMs = Date.now() - staleDeleteStartedAt;

    if (reconcileResult.skippedMissingAdvance) {
      console.warn(
        "[Ingestion] Skipping missing-state advancement and deletions because one or more sources errored",
      );
    }

    const durationMs = Date.now() - startTime;
    const timingsMs = {
      sourcesParallelMs,
      row52FetchMs,
      pypFetchMs,
      upsertFlushMs,
      staleDeleteMs,
      algoliaPrepMs: 0,
      algoliaSyncMs: 0,
    };

    await db
      .update(ingestionRun)
      .set({
        status: "success",
        vehiclesUpserted: reconcileResult.upsertedCount,
        vehiclesDeleted: reconcileResult.deletedCount,
        errors: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
        completedAt: new Date(),
      })
      .where(eq(ingestionRun.id, runId));

    console.log(
      `[Ingestion] PYP: ${pypResult.count} vehicles, Row52: ${row52Result.count} vehicles`,
    );
    console.log(
      `[Ingestion] Reconcile complete: ${reconcileResult.upsertedCount} upserted, ${reconcileResult.deletedCount} deleted, ${reconcileResult.missingUpdatedCount} marked missing`,
    );
    console.log(
      `[Ingestion] Source timings: row52=${row52FetchMs}ms pyp=${pypFetchMs}ms parallel_window=${sourcesParallelMs}ms`,
    );
    console.log(
      `[Ingestion] Stage timings: snapshot_drain=${upsertFlushMs}ms reconcile=${staleDeleteMs}ms algolia_prep=0ms algolia_sync=0ms`,
    );

    if (env.BETTERSTACK_HEARTBEAT_URL) {
      fetch(env.BETTERSTACK_HEARTBEAT_URL, { method: "HEAD" }).catch((err) => {
        console.warn(
          `[Ingestion] BetterStack heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
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
  } catch (error) {
    const msg = `Ingestion run failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);

    await db
      .update(ingestionRun)
      .set({
        status: "error",
        errors: JSON.stringify(allErrors),
        completedAt: new Date(),
      })
      .where(eq(ingestionRun.id, runId));

    if (env.BETTERSTACK_HEARTBEAT_URL) {
      fetch(`${env.BETTERSTACK_HEARTBEAT_URL}/fail`, { method: "HEAD" }).catch(
        (err) => {
          console.warn(
            `[Ingestion] BetterStack heartbeat (fail) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
    }

    throw error;
  }
}
