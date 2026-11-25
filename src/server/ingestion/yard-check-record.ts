import type { InStatement, InValue } from "@libsql/client";
import type { YardCheckReports } from "~/lib/yard-check";

/**
 * Records every covered yard's result in the run's publication batch, so a
 * rejected or abandoned run writes nothing. A source's covered yards are the
 * ones it reported and the ones it still lists after this batch refreshed
 * `yard_inventory`; a listed yard it did not report is "unreported". Only a
 * "fetched" result advances `last_checked_at`; every other result counts
 * toward `consecutive_unchecked_runs`. A yard changed when this run queued a
 * change for one of its vehicles, which also bounds its newest arrival.
 * `guard` is the publication batch's run guard and its args.
 */
export function yardCheckRecordStatement(params: {
  reports: ReadonlyMap<string, YardCheckReports>;
  acceptedSources: readonly string[];
  runId: string;
  runTimestamp: number;
  guard: { sql: string; args: InValue[] };
}): InStatement | null {
  if (params.acceptedSources.length === 0) return null;
  const accepted = new Set(params.acceptedSources);
  const reported = [...params.reports].flatMap(([source, yards]) =>
    accepted.has(source)
      ? [...yards].map(([code, outcome]) => [source, code, outcome] as const)
      : [],
  );
  const reportedSql =
    reported.length === 0
      ? "select null as source, null as location_code, null as outcome where false"
      : `select column1 as source, column2 as location_code, column3 as outcome
         from (values ${reported.map(() => "(?, ?, ?)").join(", ")})`;
  const at = params.runTimestamp;
  return {
    sql: `
      with reported as (${reportedSql}),
      covered as (
        select source, location_code from yard_inventory
        where source in (${params.acceptedSources.map(() => "?").join(", ")})
        union
        select source, location_code from reported
      ),
      changed as (
        select vehicle.source, vehicle.location_code,
          max(vehicle.first_seen_at) as newest_arrival
        from vehicle_change_v2 change
        join vehicle on vehicle.vin = change.vin
        where change.run_id = ?
        group by vehicle.source, vehicle.location_code
      )
      insert into yard_check (
        source, location_code, outcome, reported_at, reported_run_id,
        last_checked_at, last_checked_run_id, last_changed_at, last_arrival_at,
        consecutive_unchecked_runs
      )
      select covered.source, covered.location_code,
        coalesce(reported.outcome, 'unreported'), ?, ?,
        case when reported.outcome = 'fetched' then ? end,
        case when reported.outcome = 'fetched' then ? end,
        case when changed.source is not null then ? end,
        changed.newest_arrival,
        case when reported.outcome = 'fetched' then 0 else 1 end
      from covered
      left join reported on reported.source = covered.source
        and reported.location_code = covered.location_code
      left join changed on changed.source = covered.source
        and changed.location_code = covered.location_code
      where ${params.guard.sql}
      on conflict(source, location_code) do update set
        outcome = excluded.outcome,
        reported_at = excluded.reported_at,
        reported_run_id = excluded.reported_run_id,
        last_checked_at = coalesce(excluded.last_checked_at, yard_check.last_checked_at),
        last_checked_run_id = case
          when excluded.last_checked_at is null then yard_check.last_checked_run_id
          else excluded.last_checked_run_id
        end,
        last_changed_at = coalesce(excluded.last_changed_at, yard_check.last_changed_at),
        last_arrival_at = case
          when excluded.last_arrival_at is null then yard_check.last_arrival_at
          when yard_check.last_arrival_at is null then excluded.last_arrival_at
          else max(excluded.last_arrival_at, yard_check.last_arrival_at)
        end,
        consecutive_unchecked_runs = case
          when excluded.outcome = 'fetched' then 0
          else yard_check.consecutive_unchecked_runs + 1
        end
    `,
    args: [
      ...reported.flat(),
      ...params.acceptedSources,
      params.runId,
      at,
      params.runId,
      at,
      params.runId,
      at,
      ...params.guard.args,
    ],
  };
}
