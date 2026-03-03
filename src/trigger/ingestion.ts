import { logger, schedules } from "@trigger.dev/sdk";
import { runIngestion } from "~/server/ingestion/run";
import { vehicleAlgoliaProjectorTask } from "./algolia-projector";

type IngestionRunResult = Awaited<ReturnType<typeof runIngestion>>;

async function executeIngestion(): Promise<IngestionRunResult> {
  const source = "schedule";
  logger.info("Starting ingestion task", { source });
  const result = await runIngestion();
  logger.info("Completed ingestion task", {
    source,
    totalUpserted: result.totalUpserted,
    totalDeleted: result.totalDeleted,
    durationMs: result.durationMs,
    errorCount: result.errors.length,
  });

  if (result.errors.length === 0) {
    logger.info("Triggering Algolia projector after successful ingestion");
    await vehicleAlgoliaProjectorTask.trigger();
  } else {
    logger.warn(
      "Skipping Algolia projector trigger due to ingestion errors",
      { errorCount: result.errors.length },
    );
  }

  return result;
}

export const vehicleIngestionDailySchedule = schedules.task({
  id: "vehicle-ingestion-daily",
  cron: "0 7 * * *",
  maxDuration: 4 * 60 * 60,
  queue: {
    concurrencyLimit: 1,
  },
  run: async () => {
    return executeIngestion();
  },
});
