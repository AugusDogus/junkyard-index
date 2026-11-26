import pRetry from "p-retry";
import { getHookByToken, getRun, resumeHook, start } from "workflow/api";
import { HookNotFoundError, RunExpiredError } from "workflow/internal/errors";
import { getWorld } from "workflow/runtime";
import type { IngestionSource } from "~/lib/ingestion-source";
import { startManualDurableIngestionRun } from "~/server/ingestion/durable-ingestion";
import { IngestionPause } from "~/server/source-control/ingestion-pause";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { HostClaims } from "~/server/ingestion/host-claims";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import type { IngestionRunReport } from "~/server/ingestion/ingestion-pass-orchestrator";
import { SourceHostClaims } from "~/server/ingestion/source-host-claims";
import { PassHandoff } from "~/server/ingestion/pass-handoff";
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
        return handOffToPass();
      },
    },
    source,
    caller,
  );
}

const PASS_CANCEL_REASON =
  "Replaced by a pass on the current deployment so a manual run starts on current code";

/**
 * Asks today's pass to plan again, so it admits a run that shares hosts with
 * other sources. A pass on an older deployment would start the run on its
 * code, so it is replaced by one on this deployment (`PassHandoff`). With no
 * pass listening, one is started. A pass that is just finishing may miss the
 * request; the hourly cron's pass then starts the run.
 */
function handOffToPass(): Promise<PassHandoff> {
  const day = IngestionDay.key(new Date());
  const token = IngestionTokens.passReports(day);
  const replan: IngestionRunReport = { replan: true };
  return PassHandoff.request({
    findPass: async () => {
      let hook: Awaited<ReturnType<typeof getHookByToken>>;
      try {
        hook = await getHookByToken(token);
      } catch (error) {
        if (HookNotFoundError.is(error)) return null;
        throw error;
      }
      const deploymentId =
        hook.resumeContext?.deploymentId ??
        (await (await getWorld()).runs.get(hook.runId, { resolveData: "none" }))
          .deploymentId;
      return { runId: hook.runId, deploymentId };
    },
    currentDeployment: process.env.VERCEL_DEPLOYMENT_ID,
    replan: async () => {
      try {
        await resumeHook(token, replan);
        return "delivered";
      } catch (error) {
        if (HookNotFoundError.is(error) || RunExpiredError.is(error))
          return "no_pass";
        throw error;
      }
    },
    cancel: async (passRunId) => {
      const pass = getRun(passRunId);
      try {
        await pass.cancel({ cancelReason: PASS_CANCEL_REASON });
      } catch (error) {
        // A pass that ended meanwhile already released the day's token.
        const status = await pass.status;
        if (status === "pending" || status === "running") throw error;
      }
    },
    startPass: async () =>
      (
        await pRetry(
          () => start(vehicleIngestionPassWorkflow, [day]),
          workflowStartRetryOptions,
        )
      ).runId,
  });
}
