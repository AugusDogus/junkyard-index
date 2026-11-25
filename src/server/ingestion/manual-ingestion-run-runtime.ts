import pRetry from "p-retry";
import { resumeHook, start } from "workflow/api";
import type { IngestionSource } from "~/lib/ingestion-source";
import { startManualDurableIngestionRun } from "~/server/ingestion/durable-ingestion";
import { IngestionPause } from "~/server/source-control/ingestion-pause";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { HostClaims } from "~/server/ingestion/host-claims";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import type { IngestionRunReport } from "~/server/ingestion/ingestion-pass-orchestrator";
import { SourceHostClaims } from "~/server/ingestion/source-host-claims";
import { IngestionTokens } from "~/workflows/ingestion-tokens";
import {
  vehicleIngestionPassWorkflow,
  vehicleIngestionWorkflow,
} from "~/workflows/vehicle-ingestion";
import {
  ManualIngestionRun,
  type ManualIngestionRunCaller,
  type ManualIngestionRunStart,
} from "./manual-ingestion-run";

/**
 * Starts one source's ingestion now, for the cron-secret API route and the
 * admin "Run now" control alike.
 */
export function startManualIngestionRun(
  source: IngestionSource,
  caller: ManualIngestionRunCaller,
): Promise<ManualIngestionRunStart> {
  return ManualIngestionRun.start(
    {
      pauseCause: IngestionPause.cause,
      startRun: startManualDurableIngestionRun,
      startWorkflow: async (runId, runSource) => {
        if (HostClaims.isNone(SourceHostClaims.of(runSource))) {
          const run = await pRetry(
            () => start(vehicleIngestionWorkflow, [runId]),
            workflowStartRetryOptions,
          );
          return { via: "workflow", runId: run.runId };
        }
        return { via: "pass", runId: await replanIngestionPass() };
      },
    },
    source,
    caller,
  );
}

/**
 * Asks today's pass to plan again, so it admits a run that shares hosts with
 * other sources, or starts the pass if none is listening. Returns the pass's
 * workflow run. A pass that is just finishing may miss the request; the
 * hourly cron's pass then starts the run.
 */
async function replanIngestionPass(): Promise<string> {
  const day = IngestionDay.key(new Date());
  const replan: IngestionRunReport = { replan: true };
  try {
    return (await resumeHook(IngestionTokens.passReports(day), replan)).runId;
  } catch {
    // No pass is listening; a new one plans the run at once.
    const pass = await pRetry(
      () => start(vehicleIngestionPassWorkflow, [day]),
      workflowStartRetryOptions,
    );
    return pass.runId;
  }
}
