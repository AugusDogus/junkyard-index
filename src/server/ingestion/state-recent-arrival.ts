import type { InStatement } from "@libsql/client";

/**
 * How far back a rebuild keeps arrivals: the week state pages count, plus a
 * day, so a render any time after the rebuild still finds every arrival in
 * its own week, and so SQLite and JavaScript reading a zone-less date in
 * different time zones cannot drop one.
 */
export const RECENT_ARRIVAL_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Only the date fields are grouped here; readers decide which arrivals are
 * new with `YardInventory`. The filter is a superset of what they can count:
 * a recent observed arrival, a recent yard date, or a yard date SQLite cannot
 * parse. `scope` picks the vehicles read, and its args come first.
 */
function insertStatement(
  scope: { from: string; where: string; args: readonly string[] },
  now: number,
): InStatement {
  const cutoff = now - RECENT_ARRIVAL_RETENTION_MS;
  return {
    sql: `insert into state_recent_arrival
        (source, state_abbr, available_date, observed_arrival_at, vehicle_count)
      select source, state_abbr, available_date, observed_arrival_at, count(*)
      from ${scope.from}
      where ${scope.where} missing_since_at is null
        and (observed_arrival_at >= ? or (available_date is not null
          and coalesce(unixepoch(available_date, 'subsec') * 1000 >= ?, 1)))
      group by source, state_abbr, available_date, observed_arrival_at`,
    args: [...scope.args, cutoff, cutoff],
  };
}

/**
 * Rebuild these sources' `state_recent_arrival` rows from their live
 * vehicles. Run in the same batch as their `yard_inventory` refresh. Reads by
 * `vehicle_yard_live_idx` take 50 to 250 ms per large source on production
 * (November 2026).
 */
export function stateRecentArrivalRefreshStatements(
  sources: readonly string[],
  now: number,
): InStatement[] {
  const unique = [...new Set(sources)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  return [
    {
      sql: `delete from state_recent_arrival where source in (${placeholders})`,
      args: unique,
    },
    insertStatement(
      {
        from: "vehicle indexed by vehicle_yard_live_idx",
        where: `source in (${placeholders}) and`,
        args: unique,
      },
      now,
    ),
  ];
}

/**
 * Rebuild every source's rows with one scan of `vehicle`, as migration 0032
 * backfilled them, for a database whose vehicles were loaded another way.
 * The scan took 2 to 15 s on production (November 2026).
 */
export function stateRecentArrivalRebuildStatements(
  now: number,
): InStatement[] {
  return [
    "delete from state_recent_arrival",
    insertStatement({ from: "vehicle not indexed", where: "", args: [] }, now),
  ];
}
