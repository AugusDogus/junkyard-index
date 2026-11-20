import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { ingestionMaintenanceWorkflow } from "~/workflows/downstream-consumers";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The workflow reads the consumer flag in its first step and reports its
  // own tick, including a paused one.
  const run = await pRetry(
    () => start(ingestionMaintenanceWorkflow),
    workflowStartRetryOptions,
  );
  return Response.json(
    { consumer: "maintenance", workflowRunId: run.runId },
    { status: 202 },
  );
}
