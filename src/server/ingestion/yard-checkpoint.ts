import type { InStatement } from "@libsql/client";
import type { Yard } from "~/lib/yard";
import type { DurableIngestionSource } from "./durable-source";

/** Shares the vehicle checkpoint's cursor guard and write transaction. */
export function yardUpsertStatement(params: {
  runId: string;
  source: DurableIngestionSource;
  expectedCursor: string;
  yards: Yard[];
}): InStatement {
  return {
    sql: `
      insert into yard (
        source, code, name, operator, address, city, state, postal_code,
        lat, lng, website_url, phone, email, updated_at
      )
      select ${Array.from({ length: 13 }, (_, i) => `column${i + 1}`).join(", ")}, ?
      from (values ${params.yards.map(() => `(${Array(13).fill("?").join(", ")})`).join(", ")})
      where exists (
        select 1 from ingestion_source_run source_run
        join ingestion_run run on run.id = source_run.run_id
        where source_run.run_id = ? and source_run.source = ?
          and source_run.status = 'running' and source_run.next_cursor = ?
          and run.status = 'running'
      )
      on conflict(source, code) do update set
        name = excluded.name, operator = excluded.operator,
        address = excluded.address, city = excluded.city, state = excluded.state,
        postal_code = excluded.postal_code, lat = excluded.lat, lng = excluded.lng,
        website_url = excluded.website_url, phone = excluded.phone,
        email = excluded.email, updated_at = excluded.updated_at
    `,
    args: [
      Date.now(),
      ...params.yards.flatMap((yard) => [
        yard.source,
        yard.code,
        yard.name,
        yard.operator,
        yard.address,
        yard.city,
        yard.state,
        yard.postalCode,
        yard.lat,
        yard.lng,
        yard.websiteUrl,
        yard.phone,
        yard.email,
      ]),
      params.runId,
      params.source,
      params.expectedCursor,
    ],
  };
}
