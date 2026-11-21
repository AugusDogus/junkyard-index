import pRetry from "p-retry";
import { start } from "workflow/api";
import { env } from "~/env";
import { ALGOLIA_INDEX_NAME } from "~/lib/algolia";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { db } from "~/lib/db";
import { SearchIndexGenerations } from "~/server/ingestion/search-index-generation";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { workflowStartRetryOptions } from "~/server/workflows/start-retry";
import { searchProjectorWorkflow } from "~/workflows/search-projector";

/**
 * Requests a full rebuild of this deployment's search index from Turso and
 * starts the search projector, which builds it as a new generation and
 * moves it live. One rebuild runs at a time: 409 while one is in flight.
 * Nothing is written to search here. Authorized with the cron secret:
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://junkyardindex.com/api/admin/search/rebuild
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
  const environment = AlgoliaDeployment.parse(process.env.VERCEL_ENV);
  const requested = await SearchIndexGenerations.request(db, {
    environment,
    indexName: ALGOLIA_INDEX_NAME,
    reason: "operator",
    now: new Date(),
  });
  if (requested.status === "in_flight") {
    return Response.json(
      {
        error: `A search rebuild is already in flight for ${environment}; it was left running. Watch /api/status/search for its progress.`,
      },
      { status: 409 },
    );
  }
  if (requested.status === "foreign") {
    return Response.json(
      {
        error: `This database's search generations belong to the ${requested.environment} deployment, not ${environment}. Nothing was requested; run this on that deployment, or point ${environment} at its own database.`,
      },
      { status: 409 },
    );
  }
  const generationId = requested.id;
  const run = await pRetry(
    () => start(searchProjectorWorkflow),
    workflowStartRetryOptions,
  );
  return Response.json(
    { generationId, workflowRunId: run.runId },
    { status: 202 },
  );
}
