import { EntityConflictError } from "workflow/internal/errors";
import { VIN_CANONICAL_SEARCH_SCHEMA_VERSION } from "~/lib/search-index-schema";
import { SearchIndexSchemaMarker } from "./search-index-schema-marker";
import {
  canonicalizeBackfilledVinVehicles,
  canonicalizeVinVehicles,
} from "./vin-canonicalization";
import { validationRejectionKind } from "./ingestion-validation";
import type { DurableWorkflowCursor } from "./durable-workflow-cursor";
import { ALGOLIA_INDEX_NAME, getAlgoliaAdminClient } from "~/lib/algolia";
import {
  cleanupInactiveRunRebuild,
  cleanupStaleRebuildIndices,
} from "./algolia-rebuild-index";
import { env } from "~/env";
import { isIngestionSource } from "~/lib/ingestion-source";
import { db, dbClient } from "~/lib/db";
import {
  createDurableIngestionRepository,
  type CommitLeaseStatus,
} from "./durable-ingestion-repository";
import { parseAcceptedSources } from "./durable-run-state";
import type {
  DurableIngestionResult,
  DurableIngestionWakeupResult,
  DurableReconciliationBatchResult,
  DurableIngestionStart,
  DurableSourceChunkDeferral,
  DurableSourceChunkResult,
} from "./durable-ingestion-types";
import {
  ProviderChunkClock,
  ProviderNotReadyDeferred,
} from "./provider-chunk-clock";
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
import { IngestionPause } from "~/server/source-control/ingestion-pause";
import {
  PublicationModeFlag,
  PublicationModeUnavailable,
} from "./publication-mode-flag";
import {
  SearchPublicationFlag,
  type SearchPublicationMode,
} from "./search-publication-flag";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { ingestionPassPlan } from "./ingestion-pass-plan";
import { StartingMark } from "./run-workflow-starts";
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
    IngestionPause.enabledSources,
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
  const sources = await IngestionPause.enabledSources();
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
  return ingestionPassPlan(await prepareDurableIngestionWakeup(now));
}

export function listNextDurableIngestionCommitWaiters(): Promise<string[]> {
  return repository.listNextCommitWaiters();
}

export function getDurableIngestionCommitLeaseStatus(): Promise<CommitLeaseStatus> {
  return repository.getCommitLeaseStatus();
}

export function getAttachedIngestionWorkflowRuns(
  runIds: readonly string[],
): Promise<Map<string, string>> {
  return repository.getAttachedWorkflowRuns(runIds);
}

export function claimDurableIngestionCommit(
  runId: string,
): Promise<"claimed" | "busy" | "stopped"> {
  return repository.claimCommit(runId);
}

export function swapDurableIngestionWorkflowRun(
  runId: string,
  from: string | null,
  to: string | null,
): Promise<boolean> {
  return repository.swapWorkflowRun(runId, from, to);
}

export function detachDurableIngestionWorkflow(
  runId: string,
  workflowRunId: string,
): Promise<void> {
  return repository.detachWorkflowRun(runId, workflowRunId);
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
  /** Whether the run may fetch from `cursor`'s hosts; absent, it always may. */
  mayFetch?: (cursor: DurableCursorFor<Source>) => boolean;
}): Promise<
  | DurableSourceChunkResult<Source>
  | DurableSourceChunkDeferral<Source>
  | { status: "unadmitted"; cursor: DurableCursorFor<Source> }
> {
  const checkpoint = await repository.getCheckpoint({
    runId: params.runId,
    requestedCursor: params.cursor,
  });
  if (checkpoint) return checkpoint;
  // A resumed run may stand at hosts the pass did not admit it for.
  if (params.mayFetch && !params.mayFetch(params.cursor))
    return { status: "unadmitted", cursor: params.cursor };

  const fetched = await fetchDurableSourceChunk(params.cursor).catch(
    async (error: unknown) => {
      const deferral = ProviderChunkClock.deferralOf(error);
      if (deferral)
        return {
          status: "deferred" as const,
          cursor: params.cursor,
          message: `${params.cursor.source}: ${deferral.message}`,
          ...(deferral instanceof ProviderNotReadyDeferred &&
          deferral.retryAfterMs !== undefined
            ? { retryAfterMs: deferral.retryAfterMs }
            : {}),
        };
      const rejection = validationRejectionKind(error);
      if (rejection === null) throw error;
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
        // A transient rejection fails the source like any failure, so it
        // retries after the usual delay; a deterministic one ends its day.
        validationRejected: rejection === "deterministic",
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
  let searchPublication: SearchPublicationMode;
  try {
    searchPublication = await SearchPublicationFlag.publication();
  } catch (error) {
    if (!(error instanceof PublicationModeUnavailable)) throw error;
    console.warn(`[Ingestion] Run ${runId}: ${error.message}`);
    return { status: "mode_unavailable" };
  }
  // Readiness comes from Turso, not Algolia: a blocked or frozen index must
  // neither be queried here nor change the identities written to Turso.
  const makeAliasesReady =
    (await SearchIndexSchemaMarker.version(db, ALGOLIA_INDEX_NAME)) >=
    VIN_CANONICAL_SEARCH_SCHEMA_VERSION;
  return reconcileDurableIngestionRun({
    runId,
    database: db,
    batchClient: dbClient,
    snapshotStore,
    searchPublication,
    canonicalize: makeAliasesReady
      ? (rows) => canonicalizeVinVehicles(db, rows)
      : (rows) => canonicalizeBackfilledVinVehicles(db, rows),
    budgetMs: 60_000,
  });
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

/** Whether an inactive run's temporary rebuild index is gone yet. */
export type RebuildCleanup = "done" | "deferred";

/**
 * Deletes an inactive run's temporary rebuild index without ever failing the
 * caller. A copy left behind (Algolia blocked or failing, or the run still
 * active) is removed when the next rebuild starts, or by the stale-rebuild
 * sweep.
 */
async function cleanupRunRebuildBestEffort(
  runId: string,
): Promise<RebuildCleanup> {
  try {
    const outcome = await cleanupInactiveRunRebuild({
      runId,
      database: db,
      algolia: getAlgoliaAdminClient(),
      indexName: ALGOLIA_INDEX_NAME,
    });
    return outcome === "deleted" ? "done" : "deferred";
  } catch (error) {
    console.error(
      `Could not delete ingestion run ${runId}'s temporary Algolia rebuild index. The run's Turso state is saved; the next rebuild's start or the stale-rebuild sweep deletes the copy.`,
      error,
    );
    return "deferred";
  }
}

/**
 * Records a run failure in Turso, then removes the copy of a run the failure
 * abandoned, best effort: an Algolia outage cannot stop failures from being
 * recorded.
 */
export async function persistDurableIngestionFailure(
  runId: string,
  message: string,
): Promise<void> {
  await repository.markRunFailed(runId, message);
  await cleanupRunRebuildBestEffort(runId);
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

export function cleanupDurableIngestionStateBatch(runId: string) {
  return repository.cleanupBatch(runId);
}

/**
 * Deletes leaked temporary rebuild indices at the end of a completed pass.
 * Run pruning moved to the daily ingestion-maintenance consumer; this sweep
 * stays here until the search projector owns it.
 */
export async function cleanupStaleDurableAlgoliaRebuilds(): Promise<void> {
  // Frozen search makes no Algolia request. Skipped runs create no temp
  // indices; the sweep resumes once the switch is off. Decoupled, the search
  // projector owns every search write, temp-index sweeps included; an
  // unreadable mode skips the sweep until the next pass.
  if ((await PublicationModeFlag.mode()) !== "inline") return;
  if ((await SearchPublicationFlag.mode()) === "skipped") return;
  await cleanupStaleRebuildIndices({
    database: db,
    algolia: getAlgoliaAdminClient(),
    indexName: ALGOLIA_INDEX_NAME,
  });
}

/**
 * How cancelling the run's Workflow went. Already finished: the Workflow had
 * already completed, failed or been cancelled, so Workflow answered the
 * cancel with a conflict and there was nothing left to stop.
 */
export type WorkflowCancellation =
  | "cancelled"
  | "already_finished"
  | "not_attached"
  | "failed";

/**
 * What an abandon did. Already ended: the run finished or was abandoned
 * before this request got to it, so nothing was cancelled or cleaned up.
 */
export type DurableIngestionAbandonment =
  | {
      status: "abandoned";
      abandoned: { runId: string; workflowRunId: string | null };
      workflowCancellation: WorkflowCancellation;
      /** Whether the run's temporary Algolia rebuild index is already gone. */
      rebuildCleanup: RebuildCleanup;
    }
  | { status: "already_ended"; runId: string; runStatus: string };

/**
 * Abandons a run in Turso, cancels its Workflow, then deletes its rebuild copy
 * best effort: an Algolia outage cannot turn a completed abandon into a
 * failure.
 */
export async function abandonDurableIngestion(params: {
  runId: string;
  force: boolean;
  cancelWorkflow: (workflowRunId: string) => Promise<void>;
}): Promise<DurableIngestionAbandonment> {
  const result = await repository.abandon(params.runId, params.force);
  if (result.status === "already_ended") {
    return {
      status: "already_ended",
      runId: params.runId,
      runStatus: result.runStatus,
    };
  }
  // A starting mark names no workflow yet, so there is nothing to cancel;
  // the workflow started next finds the run abandoned.
  const workflowRunId =
    result.workflowRunId !== null &&
    StartingMark.parse(result.workflowRunId) === null
      ? result.workflowRunId
      : null;
  let workflowCancellation: WorkflowCancellation = "not_attached";
  if (workflowRunId) {
    try {
      await params.cancelWorkflow(workflowRunId);
      workflowCancellation = "cancelled";
    } catch (error) {
      if (EntityConflictError.is(error)) {
        workflowCancellation = "already_finished";
        console.info(
          `Abandoned ingestion run ${params.runId}; its Workflow ${workflowRunId} had already finished, so there was nothing to cancel (${error.message}).`,
        );
      } else {
        workflowCancellation = "failed";
        console.error(
          `Abandoned ingestion run ${params.runId}, but cancelling its Workflow ${workflowRunId} failed. The run stays abandoned in Turso; cancel the Workflow by hand if it is still running.`,
          error,
        );
      }
    }
  }
  return {
    status: "abandoned",
    abandoned: { runId: params.runId, workflowRunId },
    workflowCancellation,
    rebuildCleanup: await cleanupRunRebuildBestEffort(params.runId),
  };
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
