"use server";

import { getRun } from "workflow/api";
import { db } from "~/lib/db";
import { requireAdmin } from "~/server/admin/require-admin";
import { SourceRunRepository } from "~/server/admin/source-run-repository";
import { StopRunAction } from "~/server/admin/stop-run-action";
import { abandonDurableIngestion } from "~/server/ingestion/durable-ingestion";
import { startManualIngestionRun } from "~/server/ingestion/manual-ingestion-run-runtime";
import type { SourceControlResult } from "~/server/source-control/source-control-action";
import { SourceControlRepository } from "~/server/source-control/source-control-repository";

/**
 * Stops (abandons) an active ingestion run from /admin, as the cron-secret
 * POST /api/cron/vehicle-ingestion/abandon does, and optionally starts a
 * fresh run of its source. Anyone who is not an admin gets the site's 404
 * before the input is read.
 */
export async function stopIngestionRun(
  input: unknown,
): Promise<SourceControlResult> {
  const { userId } = await requireAdmin();
  return StopRunAction.perform(
    {
      readRun: (runId) => SourceRunRepository.stopTarget(db, runId),
      abandon: ({ runId, force }) =>
        abandonDurableIngestion({
          runId,
          force,
          cancelWorkflow: (workflowRunId) => getRun(workflowRunId).cancel(),
        }),
      logStop: (entry) => SourceControlRepository.logStop(db, entry),
      startRun: (source) => startManualIngestionRun(source, "admin"),
      logRun: (entry) => SourceControlRepository.logRun(db, entry),
    },
    userId,
    input,
    new Date(),
  );
}
