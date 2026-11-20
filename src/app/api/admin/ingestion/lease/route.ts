import { env } from "~/env";
import { getDurableIngestionCommitLeaseStatus } from "~/server/ingestion/durable-ingestion";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";

/**
 * Who holds the shared ingestion commit, and the oldest waiter in its FIFO
 * queue. `waiters.oldest.waitingMs` is the starvation signal. Authorized
 * with the cron secret:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://junkyardindex.com/api/admin/ingestion/lease
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
  return Response.json(await getDurableIngestionCommitLeaseStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
