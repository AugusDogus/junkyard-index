import { logger, schedules } from "@trigger.dev/sdk";
import { runIngestion } from "~/server/ingestion/run";
import { vehicleAlgoliaProjectorTask } from "./algolia-projector";
import { vehicleSearchAlertsTask } from "./search-alerts";

type IngestionRunResult = Awaited<ReturnType<typeof runIngestion>>;

function formatTaskError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

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
    logger.info("Running Algolia projector after successful ingestion");
    const projectorResult = await vehicleAlgoliaProjectorTask.triggerAndWait();
    if (!projectorResult.ok) {
      throw new Error(
        `Algolia projector task failed: ${formatTaskError(projectorResult.error)}`,
      );
    }

    logger.info("Running search alerts after projector drain");
    const alertsResult = await vehicleSearchAlertsTask.triggerAndWait();
    if (!alertsResult.ok) {
      throw new Error(
        `Search alerts task failed: ${formatTaskError(alertsResult.error)}`,
      );
    }
  } else {
    logger.warn(
      "Skipping projector and alert tasks due to ingestion errors",
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
