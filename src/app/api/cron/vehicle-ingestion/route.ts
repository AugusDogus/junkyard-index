import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { vehicleIngestionWorkflow } from "~/workflows/vehicle-ingestion";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await pRetry(
    () => start(vehicleIngestionWorkflow),
    workflowStartRetryOptions,
  );
  return Response.json(
    { message: "Vehicle ingestion workflow started", runId: run.runId },
    { status: 202 },
  );
}
