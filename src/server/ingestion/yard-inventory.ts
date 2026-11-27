import type { InStatement } from "@libsql/client";
import { DORMANT_YARD_DAYS } from "~/lib/dormant-yard";
import { stateRecentArrivalRefreshStatements } from "./state-recent-arrival";

const DAY_MS = 24 * 60 * 60 * 1000;

const columns = `source, location_code, location_name, location_city, state_abbr,
  lat, lng, vehicle_count, inventory_url, updated_at`;

/** Counts use the covering index; yard details come from one live vehicle. */
export function yardInventoryInsertSql(sourceFilter: string) {
  return `
    insert into yard_inventory (${columns})
    select live.source, live.location_code, sample.location_name,
      sample.location_city, sample.state_abbr, sample.lat, sample.lng,
      live.vehicle_count, sample.details_url, ?
    from (
      select source, location_code, count(*) as vehicle_count
      from vehicle indexed by vehicle_yard_live_idx
      where missing_since_at is null ${sourceFilter}
      group by source, location_code
    ) live
    join vehicle sample on sample.rowid = (
      select rowid from vehicle indexed by vehicle_yard_live_idx
      where source = live.source and location_code = live.location_code
        and missing_since_at is null
      limit 1
    )
    where true
    on conflict(source, location_code) do update set
      location_name = excluded.location_name, location_city = excluded.location_city,
      state_abbr = excluded.state_abbr, lat = excluded.lat, lng = excluded.lng,
      vehicle_count = excluded.vehicle_count, inventory_url = excluded.inventory_url,
      updated_at = excluded.updated_at
  `;
}

const noLiveVehicle = `not exists (select 1 from vehicle indexed by vehicle_yard_live_idx
  where vehicle.source = yard_inventory.source
    and vehicle.location_code = yard_inventory.location_code
    and vehicle.missing_since_at is null)`;

/**
 * Rebuild summaries without changing their last accepted publication. Each
 * source's recent arrivals, which state pages count, rebuild with them.
 * A yard left with no live vehicle moves to `departed_yard`, which keeps
 * its page for DORMANT_YARD_DAYS, and leaves it once it has one again.
 */
export function yardInventoryRefreshStatements(
  sources: readonly string[],
  now: number,
): InStatement[] {
  const unique = [...new Set(sources)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  return [
    ...stateRecentArrivalRefreshStatements(unique, now),
    {
      // A yard already recorded keeps the date it first departed.
      sql: `insert into departed_yard (source, location_code, location_name,
          location_city, state_abbr, lat, lng, inventory_url, departed_at)
        select source, location_code, location_name, location_city,
          state_abbr, lat, lng, inventory_url, ?
        from yard_inventory where source in (${placeholders})
          and ${noLiveVehicle}
        on conflict(source, location_code) do nothing`,
      args: [now, ...unique],
    },
    {
      sql: `delete from yard_inventory where source in (${placeholders})
        and ${noLiveVehicle}`,
      args: unique,
    },
    {
      sql: yardInventoryInsertSql(`and source in (${placeholders})`),
      args: [now, ...unique],
    },
    {
      sql: `delete from departed_yard where departed_at < ?
        or (source in (${placeholders}) and exists (
          select 1 from yard_inventory
          where yard_inventory.source = departed_yard.source
            and yard_inventory.location_code = departed_yard.location_code))`,
      args: [now - DORMANT_YARD_DAYS * DAY_MS, ...unique],
    },
  ];
}

/**
 * Stamp accepted yards in the publication transaction, leaving preserved yards
 * alone. This also backfills untracked yards on their first accepted publish;
 * summary refreshes and other yards' publications cannot establish their date.
 */
export function yardPublicationStatement(
  sources: readonly string[],
  preserved: ReadonlyMap<string, ReadonlySet<string>>,
  publishedAt: number,
): InStatement | null {
  if (sources.length === 0) return null;
  const exclusions = [...preserved].filter(([, codes]) => codes.size > 0);
  const excludedSql = exclusions
    .map(
      ([, codes]) =>
        `(source = ? and location_code in (${[...codes].map(() => "?").join(", ")}))`,
    )
    .join(" or ");
  return {
    sql: `update yard_inventory set last_published_at = ?
      where source in (${sources.map(() => "?").join(", ")})
      ${excludedSql ? `and not (${excludedSql})` : ""}`,
    args: [
      publishedAt,
      ...sources,
      ...exclusions.flatMap(([source, codes]) => [source, ...codes]),
    ],
  };
}
