import { and, eq, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionSourceRun } from "~/schema";
import type { DurableSourceCursor } from "./durable-source";
import type { DurableSourceChunkResult } from "./durable-ingestion-types";

/** Only a newly validated tenant is progress. Pages, blocked tenants, cooldowns,
 * failed chunks and replays cannot keep a failing source's heartbeat alive. */
export async function reportUrgiisCensusProgress(params: {
  database: LibSQLDatabase;
  runId: string;
  before: DurableSourceCursor;
  result: DurableSourceChunkResult;
  ping: () => Promise<void>;
}) {
  const before = params.before;
  const after = params.result.cursor;
  if (
    before.source !== "urgiis" ||
    after.source !== "urgiis" ||
    (after.runKind !== "cold" && after.runKind !== "recovery") ||
    params.result.status === "failed" ||
    after.completed.length !== before.completed.length + 1
  )
    return;
  const done = after.completed.at(-1);
  if (!done || !("accepted" in done)) return;

  // A cold run can fail after completing healthy tenants. Repeating those
  // same tenants on each retry must not mask the later failure indefinitely.
  // Project only the JSON frontier in SQL, avoiding multi-MiB cursor transfers.
  const cursor = sql`case when json_valid(${ingestionSourceRun.nextCursor}) then ${ingestionSourceRun.nextCursor} else '{}' end`;
  const [earlier] = await params.database
    .select({ id: ingestionSourceRun.id })
    .from(ingestionSourceRun)
    .where(
      and(
        eq(ingestionSourceRun.source, "urgiis"),
        ne(ingestionSourceRun.runId, params.runId),
        sql`json_extract(${cursor}, '$.scope') = ${after.scope}`,
        sql`${ingestionSourceRun.startedAt} >= (
        select coalesce(max(r.search_published_at), 0)
        from ingestion_run r join ingestion_source_run s on s.run_id = r.id
        where s.source = 'urgiis' and s.status = 'success'
          and s.acceptance_status = 'accepted'
      )`,
        sql`exists (
        select 1 from json_each(${cursor}, '$.completed')
        where json_extract(value, '$.code') = ${done.code}
          and json_extract(value, '$.accepted') > 0
      )`,
      ),
    )
    .limit(1);
  if (!earlier) await params.ping();
}
