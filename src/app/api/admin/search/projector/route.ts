import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { searchProjectorWorkflow } from "~/workflows/search-projector";

/**
 * Starts the search projector now instead of at its next cron tick. A
 * projector already running deduplicates. Its steps still check the
 * publication mode, the consumer flag and the circuit breaker. Authorized
 * with the cron secret:
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://junkyardindex.com/api/admin/search/projector
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
  const run = await pRetry(
    () => start(searchProjectorWorkflow),
    workflowStartRetryOptions,
  );
  return Response.json({ workflowRunId: run.runId }, { status: 202 });
}
