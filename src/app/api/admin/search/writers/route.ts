import { getWorld } from "workflow/runtime";
import { env } from "~/env";
import { db } from "~/lib/db";
import { SearchWriters } from "~/server/ingestion/search-writers";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";

/**
 * Lists every workflow run that may write the search index, by deployment,
 * and the runs still in an inline search stage. `singleWriter` must be true
 * before `ingestion-publication-mode` serves `decoupled` (see
 * docs/runbooks/search-projector.md). Read only. Authorized with the cron
 * secret:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://junkyardindex.com/api/admin/search/writers
 */
export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const world = await getWorld();
  const report = SearchWriters.evaluate(
    await SearchWriters.load({
      database: db,
      currentDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      now: new Date(),
      listLiveRuns: (workflowName) =>
        SearchWriters.listLiveRuns(world.runs, workflowName),
    }),
  );
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
