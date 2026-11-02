import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { hasDeliverableNotificationIntents } from "~/server/alerts/durable-alert-delivery-runtime";
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
  if (wakeup.status === "waiting") {
    return Response.json({
      message: "No vehicle source is due yet; a retry is still pending today",
    });
  }
  if (wakeup.status === "complete") {
    // Deliver once every source has published or used its attempts, so each
    // recipient's one digest per day covers every source.
    if (!(await hasDeliverableNotificationIntents())) {
      return Response.json({
        message:
          "Today's ingestion pass is complete; no notification is deliverable",
      });
    }
    const delivery = await pRetry(
      () => start(vehicleNotificationDeliveryWorkflow),
      workflowStartRetryOptions,
    );
    return Response.json({
      message: "Today's ingestion pass is complete; delivering notifications",
      deliveryWorkflowRunId: delivery.runId,
    });
  }

  // Resuming starts a workflow that exits at once if the run's workflow is
  // still alive, and otherwise continues the run from its checkpoints.
  const workflows = await Promise.all(
    wakeup.runs.map(async (run) => ({
      ...run,
      workflowRunId: (
        await pRetry(
          () => start(vehicleIngestionWorkflow, [run.runId]),
          workflowStartRetryOptions,
        )
      ).runId,
    })),
  );
  return Response.json(
    { message: "Vehicle ingestion workflows started", runs: workflows },
    { status: 202 },
  );
}
