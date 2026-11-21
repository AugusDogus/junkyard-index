import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import {
  searchProjectorTickNotifies,
  searchProjectorTickOutcome,
  summarizeSearchProjectorTick,
} from "~/server/ingestion/search-projector-consumer";
import { searchProjectorDueNow } from "~/server/ingestion/search-projector-runtime";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { searchProjectorWorkflow } from "~/workflows/search-projector";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Starts the projector only when it has work; the workflow reports its
  // own tick. Otherwise this tick is the report. Nothing here calls search.
  try {
    const due = await searchProjectorDueNow(new Date());
    if (due.status === "due") {
      const run = await pRetry(
        () => start(searchProjectorWorkflow),
        workflowStartRetryOptions,
      );
      return Response.json(
        { consumer: "search-projector", due, workflowRunId: run.runId },
        { status: 202 },
      );
    }
    await reportConsumerTickNow(
      "search-projector",
      searchProjectorTickOutcome(due),
      summarizeSearchProjectorTick(due),
      { notify: searchProjectorTickNotifies(due) },
    );
    return Response.json({ consumer: "search-projector", due });
  } catch (error) {
    await reportConsumerTickNow("search-projector", "failed", {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
