import type { InStatement } from "@libsql/client";

const columns = `source, location_code, location_name, location_city, state_abbr,
  lat, lng, vehicle_count, inventory_url, updated_at`;

/**
 * Counts come from the covering vehicle_yard_live_idx without reading vehicle
 * rows. Yard columns are the same on every vehicle of a yard, so they come
 * from one live vehicle per yard. Reading every row instead took minutes on
 * production.
 */
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
  `;
}

/**
 * Rebuilds `yard_inventory` for `sources` from their live vehicles. Run it in
 * the batch that changes those sources' vehicles, so the summary commits with
 * them.
 */
export function yardInventoryRefreshStatements(
  sources: readonly string[],
  now: number,
): InStatement[] {
  const unique = [...new Set(sources)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  return [
    {
      sql: `delete from yard_inventory where source in (${placeholders})`,
      args: unique,
    },
    {
      sql: yardInventoryInsertSql(`and source in (${placeholders})`),
      args: [now, ...unique],
    },
  ];
}
