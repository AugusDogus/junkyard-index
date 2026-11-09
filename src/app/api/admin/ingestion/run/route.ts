import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { isIngestionSource } from "~/lib/ingestion-source";
import { startManualDurableIngestionRun } from "~/server/ingestion/durable-ingestion";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { vehicleIngestionWorkflow } from "~/workflows/vehicle-ingestion";

/**
 * Starts one source's ingestion now, outside the daily pass. It counts as one
 * of today's attempts. Authorized with the cron secret:
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://junkyardindex.com/api/admin/ingestion/run?source=upullrparts
 */
export async function POST(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const source = new URL(request.url).searchParams.get("source");
  if (source === null || !isIngestionSource(source)) {
    return Response.json(
      {
        error: `Unknown ingestion source "${source ?? ""}". Pass ?source=<source>.`,
      },
      { status: 400 },
    );
  }
  const run = await startManualDurableIngestionRun(source);
  if (run.status === "busy") {
    return Response.json(
      { error: `${source} already has an active run; it was left running.` },
      { status: 409 },
    );
  }
  const workflow = await pRetry(
    () => start(vehicleIngestionWorkflow, [run.runId]),
    workflowStartRetryOptions,
  );
  return Response.json(
    { source, runId: run.runId, workflowRunId: workflow.runId },
    { status: 202 },
  );
}
