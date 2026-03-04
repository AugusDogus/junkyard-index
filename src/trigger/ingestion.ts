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

/**
 * Runs ingestion and then executes downstream search freshness steps.
 *
 * @remarks
 * The projector + alerts chain always runs after ingestion, even when one source
 * partially fails, because healthy-source upserts still need to be indexed and
 * surfaced to users. Deletion safety remains enforced inside ingestion reconcile.
 */
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

  if (result.errors.length > 0) {
    logger.warn(
      "Continuing with projector and alerts despite source ingestion errors",
      {
        errorCount: result.errors.length,
        totalUpserted: result.totalUpserted,
        totalDeleted: result.totalDeleted,
      },
    );
  }

  logger.info("Running Algolia projector after ingestion");
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
