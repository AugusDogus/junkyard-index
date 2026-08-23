import { env } from "~/env";
import { db, dbClient } from "~/lib/db";
import {
  createDurableIngestionRepository,
  parseIngestionErrors,
} from "./durable-ingestion-repository";
import { isDurableIngestionUnhealthy } from "./durable-health";
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

export type {
  DurableIngestionResult,
  DurableIngestionWakeupResult,
  DurableReconciliationBatchResult,
  DurableSourceChunkResult,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";

const HEARTBEAT_TIMEOUT_MS = 5_000;
const repository = createDurableIngestionRepository(db, dbClient);

async function sendHeartbeat(fail: boolean): Promise<void> {
  if (!env.BETTERSTACK_HEARTBEAT_URL) return;
  const response = await fetch(
    fail
      ? `${env.BETTERSTACK_HEARTBEAT_URL}/fail`
      : env.BETTERSTACK_HEARTBEAT_URL,
    {
      method: "HEAD",
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`Heartbeat responded with HTTP ${response.status}`);
  }
}

export function initializeDurableIngestion(
  runId: string,
): Promise<InitializeDurableIngestionResult> {
  return repository.initialize(runId);
}

export function prepareDurableIngestionWakeup(
  now = new Date(),
): Promise<DurableIngestionWakeupResult> {
  return repository.prepareWakeup(now);
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
  });
  return result;
}

export function validateDurableIngestionSources(runId: string) {
  return validateDurableSourceRuns({
    runId,
    database: db,
    batchClient: dbClient,
  });
}

export async function markDurableIngestionFailed(
  runId: string,
  message: string,
): Promise<void> {
  await repository.markRunFailed(runId, message);
  await sendHeartbeat(true).catch((error: unknown) => {
    console.warn("[Ingestion] BetterStack failure heartbeat failed", error);
  });
}

export async function reportDurableIngestionHealth(runId: string) {
  const run = await repository.getRun(runId);
  const failed = isDurableIngestionUnhealthy({
    status: run.status,
    inventoryOutcome: run.inventoryOutcome,
    inventoryErrors: parseIngestionErrors(run.errors),
  });
  await sendHeartbeat(failed).catch((error: unknown) => {
    console.warn("[Ingestion] BetterStack heartbeat failed", error);
  });
}

export function cleanupDurableIngestionSnapshotBatch(runId: string) {
  return repository.cleanupSnapshotBatch(runId);
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
