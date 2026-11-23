import { env } from "~/env";
import { isIngestionSource } from "~/lib/ingestion-source";
import { ManualIngestionRun } from "~/server/ingestion/manual-ingestion-run";
import { startManualIngestionRun } from "~/server/ingestion/manual-ingestion-run-runtime";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";

/**
 * Starts one source's ingestion now, outside the daily pass. It counts as one
 * of today's attempts. Retired and paused sources are refused. Authorized
 * with the cron secret; the owner can also use "Run now" on
 * /admin/sources/<source>:
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
  const run = await startManualIngestionRun(source);
  if (run.status !== "started") {
    return Response.json(
      { error: ManualIngestionRun.message(run) },
      { status: 409 },
    );
  }
  return Response.json(
    { source, runId: run.runId, workflowRunId: run.workflowRunId },
    { status: 202 },
  );
}
