import { logger, task, timeout } from "@trigger.dev/sdk";
import { runAlgoliaProjector } from "~/server/ingestion/algolia-projector";

async function executeAlgoliaProjector() {
  logger.info("Starting Algolia projector task");
  const result = await runAlgoliaProjector({
    batchSize: 1000,
    configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
  });

  logger.info("Completed Algolia projector task", {
    batchesProcessed: result.batchesProcessed,
    changesProcessed: result.changesProcessed,
    upsertsSynced: result.upsertsSynced,
    deletesSynced: result.deletesSynced,
    lastProcessedChangeId: result.lastProcessedChangeId,
  });

  return result;
}

export const vehicleAlgoliaProjectorTask = task({
  id: "vehicle-algolia-projector",
  maxDuration: timeout.None,
  queue: {
    concurrencyLimit: 1,
  },
  run: async () => {
    return executeAlgoliaProjector();
  },
});
