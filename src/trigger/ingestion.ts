import { logger, schedules } from "@trigger.dev/sdk";
import { runIngestion } from "~/server/ingestion/run";

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
