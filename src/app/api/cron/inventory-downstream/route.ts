import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { db } from "~/lib/db";
import { ConsumerFlags } from "~/server/ingestion/consumer-flags";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import { InventoryDownstream } from "~/server/ingestion/inventory-downstream";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { inventoryDownstreamWorkflow } from "~/workflows/downstream-consumers";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Starts the consumer only when a publication is due; the workflow checks
  // again and reports its own tick. Otherwise this tick is the report.
  try {
    const due = await InventoryDownstream.due(
      db,
      new Date(),
      await ConsumerFlags.mode("inventory-downstream"),
    );
    if (due.status === "due") {
      const run = await pRetry(
        () => start(inventoryDownstreamWorkflow),
        workflowStartRetryOptions,
      );
      return Response.json(
        { consumer: "inventory-downstream", due, workflowRunId: run.runId },
        { status: 202 },
      );
    }
    await reportConsumerTickNow("inventory-downstream", "succeeded", due);
    return Response.json({ consumer: "inventory-downstream", due });
  } catch (error) {
    await reportConsumerTickNow("inventory-downstream", "failed", {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
