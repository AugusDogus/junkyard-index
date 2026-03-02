import { logger, schedules } from "@trigger.dev/sdk";
import { runAlgoliaProjector } from "~/server/ingestion/algolia-projector";

export const vehicleAlgoliaProjectorSchedule = schedules.task({
  id: "vehicle-algolia-projector",
  cron: "*/5 * * * *",
  maxDuration: 60 * 60,
  queue: {
    concurrencyLimit: 1,
  },
  run: async () => {
    logger.info("Starting Algolia projector task");
    const result = await runAlgoliaProjector({
      batchSize: 1000,
      maxBatches: 50,
      configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
    });

    logger.info("Completed Algolia projector task", {
      batchesProcessed: result.batchesProcessed,
      changesProcessed: result.changesProcessed,
      upsertsSynced: result.upsertsSynced,
      deletesSynced: result.deletesSynced,
      lastProcessedChangeId: result.lastProcessedChangeId,
      hasMore: result.hasMore,
    });

    return result;
  },
});
