import { logger, schedules, task } from "@trigger.dev/sdk";
import { runIngestion } from "~/server/ingestion/run";

interface IngestionTaskPayload {
  source: "api" | "schedule";
}

type IngestionRunResult = Awaited<ReturnType<typeof runIngestion>>;

async function executeIngestion(
  source: IngestionTaskPayload["source"],
): Promise<IngestionRunResult> {
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

export const vehicleIngestionTask = task({
  id: "vehicle-ingestion",
  maxDuration: 4 * 60 * 60,
  queue: {
    concurrencyLimit: 1,
  },
  run: async (payload: IngestionTaskPayload) => {
    return executeIngestion(payload.source);
  },
});

export const vehicleIngestionDailySchedule = schedules.task({
  id: "vehicle-ingestion-daily",
  cron: "0 7 * * *",
  maxDuration: 4 * 60 * 60,
  queue: {
    concurrencyLimit: 1,
  },
  run: async () => {
    return executeIngestion("schedule");
  },
});
