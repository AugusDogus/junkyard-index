import { env } from "~/env";
import { db, dbClient } from "~/lib/db";
import {
  createDurableIngestionRepository,
  parseIngestionErrors,
} from "./durable-ingestion-repository";
import {
  syncIngestionStatusPage,
  type BetterStackStatusPageConfig,
} from "./better-stack-status-page";
import {
  classifyDurableIngestionHealth,
  type DurableIngestionHealth,
} from "./durable-health";
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
const BETTER_STACK_STATUS_PAGE_ID = 239393;
const BETTER_STACK_DAILY_INGESTION_RESOURCE_ID = 8746061;
const repository = createDurableIngestionRepository(db, dbClient);

function getBetterStackStatusPageConfig(): BetterStackStatusPageConfig | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  if (!env.BETTERSTACK_API_TOKEN) {
    throw new Error(
      "BETTERSTACK_API_TOKEN is required for production ingestion status reporting.",
    );
  }
  return {
    apiToken: env.BETTERSTACK_API_TOKEN,
    statusPageId: BETTER_STACK_STATUS_PAGE_ID,
    resourceId: BETTER_STACK_DAILY_INGESTION_RESOURCE_ID,
  };
}

async function syncProductionIngestionStatusPage(
  health: DurableIngestionHealth,
): Promise<void> {
  const config = getBetterStackStatusPageConfig();
  if (!config) return;
  const result = await syncIngestionStatusPage({ config, health });
  if (result.status === "failed") {
    throw new Error(
      `Better Stack ingestion status reporting failed during ${result.operation}: ${result.message} The ingestion result is preserved; retry this reporting step after Better Stack recovers.`,
    );
  }
}

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
  await syncProductionIngestionStatusPage("down");
}

export async function reportDurableIngestionHealth(runId: string) {
  const run = await repository.getRun(runId);
  const health = classifyDurableIngestionHealth({
    status: run.status,
    inventoryOutcome: run.inventoryOutcome,
    inventoryErrors: parseIngestionErrors(run.errors),
  });

  if (health === "degraded") {
    await syncProductionIngestionStatusPage(health);
  }
  await sendHeartbeat(health === "down").catch((error: unknown) => {
    console.warn("[Ingestion] BetterStack heartbeat failed", error);
  });
  if (health !== "degraded") {
    await syncProductionIngestionStatusPage(health);
  }
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
