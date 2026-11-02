import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { IngestionDay } from "~/server/ingestion/ingestion-day";
import { vehicleIngestionPassWorkflow } from "~/workflows/vehicle-ingestion";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The day's pass schedules every source itself. Starting it hourly only
  // revives a pass that died; a live pass deduplicates and exits.
  const day = IngestionDay.key(new Date());
  const pass = await pRetry(
    () => start(vehicleIngestionPassWorkflow, [day]),
    workflowStartRetryOptions,
  );
  return Response.json(
    {
      message: "Vehicle ingestion pass started",
      day,
      workflowRunId: pass.runId,
    },
    { status: 202 },
  );
}
