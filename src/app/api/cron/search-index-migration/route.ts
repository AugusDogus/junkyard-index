import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { searchIndexMigrationWorkflow } from "~/workflows/search-index-migration";

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
    () => start(searchIndexMigrationWorkflow),
    workflowStartRetryOptions,
  );
  return Response.json(
    { message: "Search index migration workflow started", runId: run.runId },
    { status: 202 },
  );
}
