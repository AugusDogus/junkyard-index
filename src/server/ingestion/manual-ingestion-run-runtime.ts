import pRetry from "p-retry";
import { start } from "workflow/api";
import type { IngestionSource } from "~/lib/ingestion-source";
import { startManualDurableIngestionRun } from "~/server/ingestion/durable-ingestion";
import { IngestionPause } from "~/server/source-control/ingestion-pause";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { vehicleIngestionWorkflow } from "~/workflows/vehicle-ingestion";
import {
  ManualIngestionRun,
  type ManualIngestionRunStart,
} from "./manual-ingestion-run";

/**
 * Starts one source's ingestion now, for the cron-secret API route and the
 * admin "Run now" control alike.
 */
export function startManualIngestionRun(
  source: IngestionSource,
): Promise<ManualIngestionRunStart> {
  return ManualIngestionRun.start(
    {
      pauseCause: IngestionPause.cause,
      startRun: startManualDurableIngestionRun,
      startWorkflow: (runId) =>
        pRetry(
          () => start(vehicleIngestionWorkflow, [runId]),
          workflowStartRetryOptions,
        ),
    },
    source,
  );
}
