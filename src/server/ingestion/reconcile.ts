import type { ResultSet } from "@libsql/client";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { vehicleSnapshot } from "~/schema";

interface ReconcileOptions {
  runId: string;
  runTimestamp: Date;
  healthySources: Array<"pyp" | "row52">;
  allowAdvanceMissingState: boolean;
  missingDeleteAfterRuns: number;
  missingDeleteAfterMs: number;
}

export interface ReconcileResult {
  upsertedCount: number;
  deletedCount: number;
  missingUpdatedCount: number;
  skippedMissingAdvance: boolean;
}

function readRowsAffected(result: ResultSet): number {
  return result.rowsAffected;
}

function sourceInListSql(sources: Array<"pyp" | "row52">) {
  return sql.join(
    sources.map((source) => sql`${source}`),
    sql`, `,
  );
}

export async function reconcileFromSnapshotRun(
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const runTsMs = options.runTimestamp.getTime();
  const missingSinceCutoffMs = runTsMs - options.missingDeleteAfterMs;

  if (options.healthySources.length === 0) {
    return {
      upsertedCount: 0,
      deletedCount: 0,
      missingUpdatedCount: 0,
      skippedMissingAdvance: !options.allowAdvanceMissingState,
    };
  }

  const healthySourcesSql = sourceInListSql(options.healthySources);

  const distinctVins = db
    .selectDistinct({ vin: vehicleSnapshot.vin })
    .from(vehicleSnapshot)
    .where(
      and(
        eq(vehicleSnapshot.runId, options.runId),
        inArray(vehicleSnapshot.source, options.healthySources),
      ),
    )
    .as("distinct_vins");
  const [upsertCountRow] = await db
    .select({
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(distinctVins);
  const upsertedCount = upsertCountRow?.count ?? 0;

  await db.run(sql`
    WITH ranked_snapshot AS (
      SELECT
        vin,
        source,
        year,
        make,
        model,
        color,
        stock_number,
        image_url,
        available_date,
        location_code,
        location_name,
        state,
        state_abbr,
        lat,
        lng,
        section,
        row,
        space,
        details_url,
        parts_url,
        prices_url,
        engine,
        trim,
        transmission,
        ROW_NUMBER() OVER (
          PARTITION BY vin
          ORDER BY CASE source WHEN 'row52' THEN 0 ELSE 1 END
        ) AS rn
      FROM vehicle_snapshot
      WHERE run_id = ${options.runId}
        AND source IN (${healthySourcesSql})
    ),
    latest_snapshot AS (
      SELECT
        vin,
        source,
        year,
        make,
        model,
        color,
        stock_number,
        image_url,
        available_date,
        location_code,
        location_name,
        state,
        state_abbr,
        lat,
        lng,
        section,
        row,
        space,
        details_url,
        parts_url,
        prices_url,
        engine,
        trim,
        transmission
      FROM ranked_snapshot
      WHERE rn = 1
    )
    INSERT INTO vehicle_change (
      run_id,
      vin,
      change_type,
      payload,
      payload_version,
      created_at
    )
    SELECT
      ${options.runId},
      s.vin,
      'upsert',
      NULL,
      1,
      ${runTsMs}
    FROM latest_snapshot s
    LEFT JOIN vehicle v ON v.vin = s.vin
    WHERE v.vin IS NULL
      OR v.source IS NOT s.source
      OR v.year IS NOT s.year
      OR v.make IS NOT s.make
      OR v.model IS NOT s.model
      OR v.color IS NOT s.color
      OR v.stock_number IS NOT s.stock_number
      OR v.image_url IS NOT s.image_url
      OR v.available_date IS NOT s.available_date
      OR v.location_code IS NOT s.location_code
      OR v.location_name IS NOT s.location_name
      OR v.state IS NOT s.state
      OR v.state_abbr IS NOT s.state_abbr
      OR v.lat IS NOT s.lat
      OR v.lng IS NOT s.lng
      OR v.section IS NOT s.section
      OR v.row IS NOT s.row
      OR v.space IS NOT s.space
      OR v.details_url IS NOT s.details_url
      OR v.parts_url IS NOT s.parts_url
      OR v.prices_url IS NOT s.prices_url
      OR v.engine IS NOT s.engine
      OR v.trim IS NOT s.trim
      OR v.transmission IS NOT s.transmission
      OR v.missing_since_at IS NOT NULL
      OR COALESCE(v.missing_run_count, 0) != 0
  `);

  await db.run(sql`
    WITH ranked_snapshot AS (
      SELECT
        vin,
        source,
        year,
        make,
        model,
        color,
        stock_number,
        image_url,
        available_date,
        location_code,
        location_name,
        state,
        state_abbr,
        lat,
        lng,
        section,
        row,
        space,
        details_url,
        parts_url,
        prices_url,
        engine,
        trim,
        transmission,
        ROW_NUMBER() OVER (
          PARTITION BY vin
          ORDER BY CASE source WHEN 'row52' THEN 0 ELSE 1 END
        ) AS rn
      FROM vehicle_snapshot
      WHERE run_id = ${options.runId}
        AND source IN (${healthySourcesSql})
    )
    INSERT INTO vehicle (
      vin,
      source,
      year,
      make,
      model,
      color,
      stock_number,
      image_url,
      available_date,
      location_code,
      location_name,
      state,
      state_abbr,
      lat,
      lng,
      section,
      row,
      space,
      details_url,
      parts_url,
      prices_url,
      engine,
      trim,
      transmission,
      first_seen_at,
      last_seen_at,
      missing_since_at,
      missing_run_count
    )
    SELECT
      vin,
      source,
      year,
      make,
      model,
      color,
      stock_number,
      image_url,
      available_date,
      location_code,
      location_name,
      state,
      state_abbr,
      lat,
      lng,
      section,
      row,
      space,
      details_url,
      parts_url,
      prices_url,
      engine,
      trim,
      transmission,
      ${runTsMs},
      ${runTsMs},
      NULL,
      0
    FROM ranked_snapshot
    WHERE rn = 1
    ON CONFLICT(vin) DO UPDATE SET
      source = excluded.source,
      year = excluded.year,
      make = excluded.make,
      model = excluded.model,
      color = excluded.color,
      stock_number = excluded.stock_number,
      image_url = excluded.image_url,
      available_date = excluded.available_date,
      location_code = excluded.location_code,
      location_name = excluded.location_name,
      state = excluded.state,
      state_abbr = excluded.state_abbr,
      lat = excluded.lat,
      lng = excluded.lng,
      section = excluded.section,
      row = excluded.row,
      space = excluded.space,
      details_url = excluded.details_url,
      parts_url = excluded.parts_url,
      prices_url = excluded.prices_url,
      engine = excluded.engine,
      trim = excluded.trim,
      transmission = excluded.transmission,
      last_seen_at = excluded.last_seen_at,
      missing_since_at = NULL,
      missing_run_count = 0
  `);

  if (!options.allowAdvanceMissingState) {
    return {
      upsertedCount,
      deletedCount: 0,
      missingUpdatedCount: 0,
      skippedMissingAdvance: true,
    };
  }

  const deleteChangesResult = await db.run(sql`
    INSERT INTO vehicle_change (
      run_id,
      vin,
      change_type,
      payload,
      payload_version,
      created_at
    )
    SELECT
      ${options.runId},
      vin,
      'delete',
      NULL,
      1,
      ${runTsMs}
    FROM vehicle
    WHERE last_seen_at < ${runTsMs}
      AND (
        COALESCE(missing_run_count, 0) + 1 >= ${options.missingDeleteAfterRuns}
        OR COALESCE(missing_since_at, ${runTsMs}) <= ${missingSinceCutoffMs}
      )
  `);
  const deletedCount = readRowsAffected(deleteChangesResult);

  const missingChangesResult = await db.run(sql`
    INSERT INTO vehicle_change (
      run_id,
      vin,
      change_type,
      payload,
      payload_version,
      created_at
    )
    SELECT
      ${options.runId},
      vin,
      'missing',
      NULL,
      1,
      ${runTsMs}
    FROM vehicle
    WHERE last_seen_at < ${runTsMs}
      AND NOT (
        COALESCE(missing_run_count, 0) + 1 >= ${options.missingDeleteAfterRuns}
        OR COALESCE(missing_since_at, ${runTsMs}) <= ${missingSinceCutoffMs}
      )
  `);
  const missingUpdatedCount = readRowsAffected(missingChangesResult);

  await db.run(sql`
    UPDATE vehicle
    SET missing_since_at = ${runTsMs}
    WHERE last_seen_at < ${runTsMs}
      AND missing_since_at IS NULL
  `);

  await db.run(sql`
    UPDATE vehicle
    SET missing_run_count = COALESCE(missing_run_count, 0) + 1
    WHERE last_seen_at < ${runTsMs}
  `);

  await db.run(sql`
    DELETE FROM vehicle
    WHERE last_seen_at < ${runTsMs}
      AND (
        COALESCE(missing_run_count, 0) >= ${options.missingDeleteAfterRuns}
        OR missing_since_at <= ${missingSinceCutoffMs}
      )
  `);

  return {
    upsertedCount,
    deletedCount,
    missingUpdatedCount,
    skippedMissingAdvance: false,
  };
}
