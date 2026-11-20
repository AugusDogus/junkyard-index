import { isValidationRejection } from "./ingestion-validation";
import type { DurableWorkflowCursor } from "./durable-workflow-cursor";
import { pruneIngestionRuns } from "./ingestion-run-retention";
import { ALGOLIA_INDEX_NAME, getAlgoliaAdminClient } from "~/lib/algolia";
import {
  cleanupStaleRebuildIndices,
  cleanupInactiveRunRebuild,
} from "./algolia-rebuild-index";
import { env } from "~/env";
import { isIngestionSource } from "~/lib/ingestion-source";
import { db, dbClient } from "~/lib/db";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type { IngestionSourceFreshness } from "./durable-health";
import { parseAcceptedSources } from "./durable-run-state";
import type {
  DurableIngestionResult,
  DurableIngestionWakeupResult,
  DurableReconciliationBatchResult,
  DurableIngestionStart,
  DurableSourceChunkDeferral,
  DurableSourceChunkResult,
} from "./durable-ingestion-types";
import { ProviderChunkClock } from "./provider-chunk-clock";
import {
  getDurableSourceDefinition,
  type DurableCursorFor,
  type DurableIngestionSource,
} from "./durable-source";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { fetchDurableSourceChunk } from "./durable-source-fetch";
import { IngestionDay } from "./ingestion-day";
import type { IngestionPassPlan } from "./ingestion-pass-orchestrator";
import {
  InventoryCacheRefresh,
  type InventoryCacheSource,
} from "./inventory-cache-refresh";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { BetterStackProviders } from "./better-stack-providers";
import { reportUrgiisCensusProgress } from "./urgiis-progress";

export type {
  DurableIngestionResult,
  DurableIngestionWakeupResult,
  DurableReconciliationBatchResult,
  DurableSourceChunkDeferral,
  DurableSourceChunkResult,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";

const BETTER_STACK_STATUS_PAGE_ID = 239393;
const betterStackProviders = BetterStackProviders.parse(
  env.BETTERSTACK_PROVIDERS,
);
const snapshotStore = IngestionSnapshotStore.vercelBlob(
  env.BLOB_READ_WRITE_TOKEN,
);
const repository = createDurableIngestionRepository(
  db,
  dbClient,
  snapshotStore,
);

export async function initializeDurableIngestion(
  runId: string,
): Promise<DurableIngestionStart> {
  const result = await repository.initialize(
    runId,
    IngestionSourceFlags.enabledSources,
  );
  if (result.status !== "started") return result;
  return {
    status: "started",
    runId: result.runId,
    initialCursors: result.sources.map(
      (source) => getDurableSourceDefinition(source).initialCursor,
    ),
  };
}

export async function prepareDurableIngestionWakeup(
  now = new Date(),
): Promise<DurableIngestionWakeupResult> {
  const sources = await IngestionSourceFlags.enabledSources();
  return repository.prepareWakeup(now, sources);
}

export function startManualDurableIngestionRun(source: DurableIngestionSource) {
  return repository.startManualRun(source);
}

/** Plans the day's pass; a pass for an earlier day has expired. */
export async function prepareIngestionPass(
  day: string,
): Promise<IngestionPassPlan> {
  const now = new Date();
  if (IngestionDay.key(now) !== day) return { status: "expired" };
  const wakeup = await prepareDurableIngestionWakeup(now);
  return wakeup.status === "active"
    ? { status: "active", runIds: wakeup.runs.map((run) => run.runId) }
    : wakeup;
}

/**
 * Stores what inventory caches read and revalidates them, if a newer
 * publication exists than they show.
 */
export function refreshInventoryCaches(params: {
  source: InventoryCacheSource;
  revalidate: () => void;
}): Promise<InventoryCacheRefresh> {
  return InventoryCacheRefresh.run({ database: db, ...params });
}

export function listDurableIngestionCommitWaiters(): Promise<string[]> {
  return repository.listCommitWaiters();
}

export function claimDurableIngestionCommit(
  runId: string,
): Promise<"claimed" | "busy" | "stopped"> {
  return repository.claimCommit(runId);
}

export function attachDurableIngestionWorkflow(
  runId: string,
  workflowRunId: string,
): Promise<void> {
  return repository.attachWorkflowRun(runId, workflowRunId);
}

export async function runDurableSourceChunk<
  Source extends DurableIngestionSource,
>(params: {
  runId: string;
  cursor: DurableCursorFor<Source>;
}): Promise<
  DurableSourceChunkResult<Source> | DurableSourceChunkDeferral<Source>
> {
  const checkpoint = await repository.getCheckpoint({
    runId: params.runId,
    requestedCursor: params.cursor,
  });
  if (checkpoint) return checkpoint;

  const fetched = await fetchDurableSourceChunk(params.cursor).catch(
    async (error: unknown) => {
      const deferral = ProviderChunkClock.deferralOf(error);
      if (deferral)
        return {
          status: "deferred" as const,
          cursor: params.cursor,
          message: `${params.cursor.source}: ${deferral.message}`,
        };
      if (!isValidationRejection(error)) throw error;
      return repository.markSourceFailed({
        runId: params.runId,
        source: params.cursor.source,
        message:
          error instanceof Error
            ? error.message
            : typeof error === "object" &&
                error !== null &&
                "message" in error &&
                typeof error.message === "string"
              ? error.message
              : "Provider validation rejected the frozen crawl; inspect the saved source evidence before retrying.",
        validationRejected: true,
      });
    },
  );
  if (!("vehicles" in fetched)) return fetched;
  const result = await repository.checkpointChunk({
    runId: params.runId,
    requestedCursor: params.cursor,
    fetched,
  });
  if (process.env.VERCEL_ENV === "production") {
    try {
      await reportUrgiisCensusProgress({
        database: db,
        runId: params.runId,
        before: params.cursor,
        result,
        ping: () =>
          BetterStackProviders.progress({
            providers: betterStackProviders,
            source: "urgiis",
          }),
      });
    } catch (error) {
      console.error(
        "Could not report URG cold census progress; the saved checkpoint is preserved",
        error,
      );
    }
  }
  return result;
}

export function markDurableSourceFailed<
  Source extends DurableIngestionSource,
>(params: {
  runId: string;
  source: Source;
  message: string;
}): Promise<DurableSourceChunkResult<Source>> {
  return repository.markSourceFailed(params);
}

export async function reconcileDurableIngestion(
  runId: string,
): Promise<DurableReconciliationBatchResult> {
  const result = await reconcileDurableIngestionRun({
    runId,
    database: db,
    batchClient: dbClient,
    snapshotStore,
  });
  return result;
}

export function validateDurableIngestionSources(runId: string) {
  return validateDurableSourceRuns({
    runId,
    database: db,
    batchClient: dbClient,
    snapshotStore,
  });
}

export async function markDurableIngestionFailed(
  runId: string,
  message: string,
): Promise<void> {
  await persistDurableIngestionFailure(runId, message);
}

export async function persistDurableIngestionFailure(
  runId: string,
  message: string,
): Promise<void> {
  await repository.markRunFailed(runId, message);
  await cleanupInactiveRunRebuild({
    runId,
    database: db,
    algolia: getAlgoliaAdminClient(),
    indexName: ALGOLIA_INDEX_NAME,
  });
}

/**
 * Shows a source run's outcome on its provider's public status row: an
 * accepted inventory publication pings its heartbeat and clears a delay
 * report, whether or not search has caught up; any other outcome reports the
 * provider delayed (yellow) while its last inventory stays up.
 */
export async function reportDurableProviderStatus(runId: string) {
  if (process.env.VERCEL_ENV !== "production") return;
  const run = await repository.getRun(runId);
  if (!isIngestionSource(run.source)) return;
  if (!env.BETTERSTACK_API_TOKEN) {
    throw new Error(
      "BETTERSTACK_API_TOKEN is required to report provider status in production. Set it to a Better Stack Uptime API token.",
    );
  }
  const published =
    run.inventoryPublishedAt !== null &&
    parseAcceptedSources(run.acceptedSources).includes(run.source);
  await BetterStackProviders.report({
    providers: betterStackProviders,
    apiToken: env.BETTERSTACK_API_TOKEN,
    statusPageId: BETTER_STACK_STATUS_PAGE_ID,
    source: run.source,
    state: published ? "published" : "retrying",
  });
}

/** Each source's latest attempt and accepted publication in the last 3 days. */
export function getDurableSourceFreshness(
  now: Date,
): Promise<IngestionSourceFreshness[]> {
  return repository.getSourceFreshness(now);
}

export function cleanupDurableIngestionStateBatch(runId: string) {
  return repository.cleanupBatch(runId);
}

export function cleanupStaleDurableIngestionSnapshots(): Promise<void> {
  return repository.cleanupStaleSnapshots();
}

export async function cleanupStaleDurableAlgoliaRebuilds(): Promise<void> {
  await pruneIngestionRuns({ database: db });
  await cleanupStaleRebuildIndices({
    database: db,
    algolia: getAlgoliaAdminClient(),
    indexName: ALGOLIA_INDEX_NAME,
  });
}

export async function abandonDurableIngestion(
  runId: string,
  force = false,
): Promise<string | null> {
  const workflowRunId = await repository.abandon(runId, force);
  await cleanupInactiveRunRebuild({
    runId,
    database: db,
    algolia: getAlgoliaAdminClient(),
    indexName: ALGOLIA_INDEX_NAME,
  });
  return workflowRunId;
}

export const compactDurableWorkflowCursor = <
  Source extends DurableIngestionSource,
>(
  runId: string,
  cursor: DurableCursorFor<Source>,
) => repository.workflowCursor(runId, cursor);
export const resolveDurableWorkflowCursor = <
  Source extends DurableIngestionSource,
>(
  runId: string,
  cursor: DurableWorkflowCursor<Source>,
) => repository.resolveWorkflowCursor(runId, cursor);
