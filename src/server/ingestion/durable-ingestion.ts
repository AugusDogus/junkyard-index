import { env } from "~/env";
import { db } from "~/lib/db";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import type {
  DurableIngestionResult,
  DurableSourceChunkResult,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";
import type {
  DurableCursorFor,
  DurableIngestionSource,
} from "./durable-source";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { fetchDurableSourceChunk } from "./durable-source-fetch";

export type {
  DurableIngestionResult,
  DurableSourceChunkResult,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";

const HEARTBEAT_TIMEOUT_MS = 5_000;
const repository = createDurableIngestionRepository(db);

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
): Promise<DurableIngestionResult> {
  const result = await reconcileDurableIngestionRun({
    runId,
    repository,
    database: db,
  });
  await sendHeartbeat(result.errors.length > 0).catch((error: unknown) => {
    console.warn("[Ingestion] BetterStack heartbeat failed", error);
  });
  return result;
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

export function cleanupDurableIngestionSnapshots(runId: string): Promise<void> {
  return repository.cleanupSnapshots(runId);
}

export function cleanupStaleDurableIngestionSnapshots(): Promise<void> {
  return repository.cleanupStaleSnapshots();
}
