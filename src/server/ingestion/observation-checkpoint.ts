import type { InStatement } from "@libsql/client";
import type { IngestionSource } from "~/lib/ingestion-source";

/** Presence evidence commits under the same cursor guard as vehicle snapshots. */
export function observationInsertStatement(params: {
  runId: string;
  source: IngestionSource;
  expectedCursor: string;
  vins: string[];
}): InStatement {
  return {
    sql: `
      insert into vehicle_observation (run_id, source, vin)
      select ?, ?, column1 from (values ${params.vins.map(() => "(?)").join(", ")})
      where exists (
        select 1 from ingestion_source_run source_run
        join ingestion_run run on run.id = source_run.run_id
        where source_run.run_id = ? and source_run.source = ?
          and source_run.status = 'running' and source_run.next_cursor = ?
          and run.status = 'running'
      )
      on conflict(run_id, source, vin) do nothing
    `,
    args: [
      params.runId,
      params.source,
      ...params.vins,
      params.runId,
      params.source,
      params.expectedCursor,
    ],
  };
}
