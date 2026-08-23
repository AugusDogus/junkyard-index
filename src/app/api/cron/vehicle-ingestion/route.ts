import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { prepareDurableIngestionWakeup } from "~/server/ingestion/durable-ingestion";
import {
  vehicleIngestionWorkflow,
  vehicleNotificationDeliveryWorkflow,
} from "~/workflows/vehicle-ingestion";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wakeup = await prepareDurableIngestionWakeup();
  if (wakeup.status === "not_due") {
    const delivery = await pRetry(
      () => start(vehicleNotificationDeliveryWorkflow),
      workflowStartRetryOptions,
    );
    return Response.json({
      message: "Vehicle ingestion is not due",
      publishedRunId: wakeup.publishedRunId,
      deliveryWorkflowRunId: delivery.runId,
    });
  }

  const workflow = await pRetry(
    () => start(vehicleIngestionWorkflow, [wakeup.runId]),
    workflowStartRetryOptions,
  );
  return Response.json(
    {
      message: `Vehicle ingestion workflow ${wakeup.status === "resume" ? "resumed" : "started"}`,
      runId: wakeup.runId,
      workflowRunId: workflow.runId,
    },
    { status: 202 },
  );
}
