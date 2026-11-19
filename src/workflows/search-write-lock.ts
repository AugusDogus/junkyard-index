import { createHook, sleep } from "workflow";
import { withAlgoliaWriterLock } from "~/server/ingestion/algolia-writer-lock";
import { IngestionTokens } from "./ingestion-tokens";

const LOCK_RETRY_DELAY = "30s";

/**
 * Runs `run` under the shared Algolia writer lock: search projection, schema
 * migrations, and each saved-search alert check batch (all its pages and
 * checkpoints), so one stable index serves a whole alert scan.
 */
export function withSearchWriteLock<Result>(
  run: () => Promise<Result>,
): Promise<Result> {
  return withAlgoliaWriterLock({
    acquire: () => createHook({ token: IngestionTokens.algoliaWrites }),
    waitForWriter: async (activeRunId) => {
      console.info(`[Workflow] Waiting for Algolia writer ${activeRunId}`);
      await sleep(LOCK_RETRY_DELAY);
    },
    write: run,
  });
}
