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
  DurableSourceChunkResult,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";
import type {
  DurableCursorFor,
  DurableIngestionSource,
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

export type {
  DurableIngestionResult,
  DurableIngestionWakeupResult,
  DurableReconciliationBatchResult,
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

export function initializeDurableIngestion(
  runId: string,
): Promise<InitializeDurableIngestionResult> {
  return repository.initialize(runId, IngestionSourceFlags.enabledSources);
}

export async function prepareDurableIngestionWakeup(
  now = new Date(),
): Promise<DurableIngestionWakeupResult> {
  const sources = await IngestionSourceFlags.enabledSources();
  return repository.prepareWakeup(now, sources);
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
}): Promise<DurableSourceChunkResult<Source>> {
  const checkpoint = await repository.getCheckpoint({
    runId: params.runId,
    requestedCursor: params.cursor,
  });
  if (checkpoint) return checkpoint;

  const fetched = await fetchDurableSourceChunk(params.cursor);
  return repository.checkpointChunk({
    runId: params.runId,
    requestedCursor: params.cursor,
    fetched,
  });
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

export function persistDurableIngestionFailure(
  runId: string,
  message: string,
): Promise<void> {
  return repository.markRunFailed(runId, message);
}

/**
 * Shows a source run's outcome on its provider's public status row: a good
 * publication pings its heartbeat and clears a delay report; any other
 * outcome reports the provider delayed (yellow) while its last inventory stays
 * up.
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
    run.status === "success" &&
    run.searchPublishedAt !== null &&
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

export function abandonDurableIngestion(
  runId: string,
  force = false,
): Promise<string | null> {
  return repository.abandon(runId, force);
}
