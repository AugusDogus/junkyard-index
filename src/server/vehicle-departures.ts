import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

// Vehicles that ingestion changed this recently are checked for a return.
// Captures run hourly, so this covers a missed capture or two. Runs that
// wrote in this window widen it to their commit time; see below.
const RECENTLY_SEEN_MS = 3 * 60 * 60 * 1000;

export type DepartureCapture = {
  /** Departures recorded by this capture. */
  recorded: number;
  /** Recent departures withdrawn because the vehicle is listed again. */
  withdrawn: number;
};

/**
 * Records every vehicle currently marked missing as a departure, before
 * ingestion deletes it, then withdraws departures of listings that came back.
 * Runs repeatedly without duplicating rows: a departure is keyed by VIN and
 * the run that first missed it.
 */
export async function captureVehicleDepartures(
  database: LibSQLDatabase,
  now: Date,
): Promise<DepartureCapture> {
  // `> 0` rather than `is not null`: SQLite answers the range from
  // vehicle_missing_since_at_idx, reading only missing vehicles, but scans
  // the whole table for `is not null`.
  const inserted = await database.run(sql`
    insert into vehicle_departure (
      vin, source, location_code, year, make, model, available_date,
      first_seen_at, departed_at, recorded_at
    )
    select vin, source, location_code, year, make, model, available_date,
      first_seen_at, missing_since_at, ${now.getTime()}
    from vehicle
    where missing_since_at > 0
    on conflict do nothing
  `);
  // A departure is withdrawn when the same listing (VIN and first-seen time)
  // is no longer missing since that departure: it is listed again, or it
  // returned and left again, which records a newer departure. Ingestion
  // updates last_seen_at when it clears the missing mark, so only recently
  // seen vehicles are checked: an index range on last_seen_at, then primary
  // key lookups. A VIN listed anew after deletion has a new first-seen time,
  // so its earlier departure stands.
  //
  // Ingestion stamps last_seen_at with its run's commit time, which is hours
  // old when a stalled commit resumes. Each reconcile batch records the run's
  // last_progress_at with its writes, so the window also reaches back to the
  // commit time of every run that wrote recently.
  const recently = now.getTime() - RECENTLY_SEEN_MS;
  const deleted = await database.run(sql`
    delete from vehicle_departure
    where vin in (
        select vin from vehicle
        where last_seen_at >= min(${recently}, coalesce((
          select min(coalesce(commit_started_at, started_at))
          from ingestion_run
          where last_progress_at >= ${recently}
        ), ${recently}))
      )
      and exists (
        select 1 from vehicle
        where vehicle.vin = vehicle_departure.vin
          and vehicle.first_seen_at = vehicle_departure.first_seen_at
          and (
            vehicle.missing_since_at is null
            or vehicle.missing_since_at <> vehicle_departure.departed_at
          )
      )
  `);
  return { recorded: inserted.rowsAffected, withdrawn: deleted.rowsAffected };
}
