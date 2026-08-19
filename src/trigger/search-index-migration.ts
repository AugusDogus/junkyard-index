import { logger, tags, task } from "@trigger.dev/sdk";
import {
  migrateSearchIndexToVinPatternSchema,
  SearchIndexMigrationValidationError,
} from "~/server/ingestion/search-index-migration";
import { algoliaWritesQueue } from "./queues";

export const searchIndexMigrationTask = task({
  id: "search-index-schema-v2",
  maxDuration: 4 * 60 * 60,
  queue: algoliaWritesQueue,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 30_000,
    randomize: true,
  },
  catchError: ({ error }) =>
    error instanceof SearchIndexMigrationValidationError
      ? { skipRetrying: true }
      : undefined,
  run: async (_payload: Record<string, never>) => {
    await tags.add("search-index-migration");
    logger.info("Starting search index schema migration");
    const result = await migrateSearchIndexToVinPatternSchema({
      batchSize: 1000,
      onProgress: (progress) => {
        logger.info("Search index migration progress", {
          batchesProcessed: progress.batchesProcessed,
          recordsProcessed: progress.recordsProcessed,
        });
      },
    });

    logger.info("Completed search index schema migration", {
      alreadyReady: result.alreadyReady,
      batchesProcessed: result.batchesProcessed,
      recordsProcessed: result.recordsProcessed,
      schemaVersion: result.schemaVersion,
      validatedVins: result.validatedVins,
    });
    return result;
  },
});
