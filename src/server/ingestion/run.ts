import { eq, lt, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { ingestionRun, vehicle } from "~/schema";
import { fetchPypInventory } from "./pyp-connector";
import { fetchRow52Inventory } from "./row52-connector";
import { syncToAlgolia } from "./sync-algolia";
import type { CanonicalVehicle } from "./types";
import { toAlgoliaRecord } from "./types";

const UPSERT_BATCH_SIZE = 200;

/**
 * Upsert vehicles into Turso in batches using raw SQL for ON CONFLICT.
 * Preserves firstSeenAt for existing records, sets it to runTimestamp for new ones.
 */
async function upsertVehicles(
  vehicles: CanonicalVehicle[],
  runTimestamp: Date,
): Promise<number> {
  let upserted = 0;

  for (let i = 0; i < vehicles.length; i += UPSERT_BATCH_SIZE) {
    const batch = vehicles.slice(i, i + UPSERT_BATCH_SIZE);

    // Use a transaction for each batch
    await db.batch(
      batch.map((v) =>
        db.run(
          sql`INSERT INTO vehicle (
            vin, source, year, make, model, color, stock_number, image_url,
            available_date, location_code, location_name, state, state_abbr,
            lat, lng, section, row, space, details_url, parts_url, prices_url,
            engine, trim, transmission, first_seen_at, last_seen_at
          ) VALUES (
            ${v.vin}, ${v.source}, ${v.year}, ${v.make}, ${v.model}, ${v.color},
            ${v.stockNumber}, ${v.imageUrl}, ${v.availableDate}, ${v.locationCode},
            ${v.locationName}, ${v.state}, ${v.stateAbbr}, ${v.lat}, ${v.lng},
            ${v.section}, ${v.row}, ${v.space}, ${v.detailsUrl}, ${v.partsUrl},
            ${v.pricesUrl}, ${v.engine}, ${v.trim}, ${v.transmission},
            ${runTimestamp.getTime()}, ${runTimestamp.getTime()}
          )
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
            first_seen_at = vehicle.first_seen_at,
            last_seen_at = excluded.last_seen_at`,
        ),
      ),
    );

    upserted += batch.length;
    if (i % 1000 === 0 && i > 0) {
      console.log(`[Ingestion] Upserted ${upserted}/${vehicles.length} vehicles`);
    }
  }

  return upserted;
}

/**
 * Delete stale vehicles (those not seen in this run) and return their VINs.
 */
async function deleteStaleVehicles(runTimestamp: Date): Promise<string[]> {
  // First, get the VINs that will be deleted (for Algolia cleanup)
  const staleVehicles = await db
    .select({ vin: vehicle.vin })
    .from(vehicle)
    .where(lt(vehicle.lastSeenAt, runTimestamp));

  const staleVins = staleVehicles.map((v) => v.vin);

  if (staleVins.length > 0) {
    await db.delete(vehicle).where(lt(vehicle.lastSeenAt, runTimestamp));
    console.log(`[Ingestion] Deleted ${staleVins.length} stale vehicles`);
  }

  return staleVins;
}

/**
 * Run the full ingestion pipeline:
 * 1. Fetch inventory from PYP and Row52 in parallel
 * 2. Deduplicate by VIN (PYP preferred)
 * 3. Upsert into Turso
 * 4. Delete stale records
 * 5. Sync delta to Algolia
 */
export async function runIngestion(): Promise<{
  totalUpserted: number;
  totalDeleted: number;
  pypCount: number;
  row52Count: number;
  errors: string[];
  durationMs: number;
}> {
  const startTime = Date.now();
  const runTimestamp = new Date();
  const runId = crypto.randomUUID();
  const allErrors: string[] = [];

  console.log(`[Ingestion] Starting run ${runId} at ${runTimestamp.toISOString()}`);

  // Record run start
  await db.insert(ingestionRun).values({
    id: runId,
    source: "all",
    status: "running",
    startedAt: runTimestamp,
  });

  try {
    // 1. Fetch from both sources in parallel
    const [pypResult, row52Result] = await Promise.all([
      fetchPypInventory().catch((error) => {
        const msg = `PYP ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        return { source: "pyp" as const, vehicles: [] as CanonicalVehicle[], errors: [msg] };
      }),
      fetchRow52Inventory().catch((error) => {
        const msg = `Row52 ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        return { source: "row52" as const, vehicles: [] as CanonicalVehicle[], errors: [msg] };
      }),
    ]);

    allErrors.push(...pypResult.errors, ...row52Result.errors);

    console.log(
      `[Ingestion] PYP: ${pypResult.vehicles.length} vehicles, Row52: ${row52Result.vehicles.length} vehicles`,
    );

    // 2. Deduplicate by VIN (PYP preferred over Row52)
    const vinMap = new Map<string, CanonicalVehicle>();

    // Add Row52 first, then PYP (PYP overwrites duplicates)
    for (const v of row52Result.vehicles) {
      if (v.vin) vinMap.set(v.vin, v);
    }
    for (const v of pypResult.vehicles) {
      if (v.vin) vinMap.set(v.vin, v);
    }

    const deduplicatedVehicles = Array.from(vinMap.values());
    console.log(
      `[Ingestion] After dedup: ${deduplicatedVehicles.length} unique vehicles`,
    );

    // 3. Upsert into Turso
    const totalUpserted = await upsertVehicles(deduplicatedVehicles, runTimestamp);
    console.log(`[Ingestion] Upserted ${totalUpserted} vehicles into Turso`);

    // 4. Delete stale records
    const deletedVins = await deleteStaleVehicles(runTimestamp);
    console.log(`[Ingestion] Deleted ${deletedVins.length} stale vehicles`);

    // 5. Build Algolia records from the DB (to get accurate firstSeenAt)
    // Query all vehicles from DB to get their firstSeenAt timestamps
    const allDbVehicles = await db.select().from(vehicle);
    const algoliaRecords = allDbVehicles.map((dbVehicle) =>
      toAlgoliaRecord(
        {
          vin: dbVehicle.vin,
          source: dbVehicle.source as "pyp" | "row52",
          year: dbVehicle.year,
          make: dbVehicle.make,
          model: dbVehicle.model,
          color: dbVehicle.color,
          stockNumber: dbVehicle.stockNumber,
          imageUrl: dbVehicle.imageUrl,
          availableDate: dbVehicle.availableDate,
          locationCode: dbVehicle.locationCode,
          locationName: dbVehicle.locationName,
          state: dbVehicle.state,
          stateAbbr: dbVehicle.stateAbbr,
          lat: dbVehicle.lat,
          lng: dbVehicle.lng,
          section: dbVehicle.section,
          row: dbVehicle.row,
          space: dbVehicle.space,
          detailsUrl: dbVehicle.detailsUrl,
          partsUrl: dbVehicle.partsUrl,
          pricesUrl: dbVehicle.pricesUrl,
          engine: dbVehicle.engine,
          trim: dbVehicle.trim,
          transmission: dbVehicle.transmission,
        },
        dbVehicle.firstSeenAt,
      ),
    );

    // 6. Sync to Algolia
    await syncToAlgolia(algoliaRecords, deletedVins);

    const durationMs = Date.now() - startTime;

    // Update run record
    await db
      .update(ingestionRun)
      .set({
        status: "success",
        vehiclesUpserted: totalUpserted,
        vehiclesDeleted: deletedVins.length,
        errors: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
        completedAt: new Date(),
      })
      .where(eq(ingestionRun.id, runId));

    console.log(
      `[Ingestion] Run complete in ${durationMs}ms: ${totalUpserted} upserted, ${deletedVins.length} deleted`,
    );

    return {
      totalUpserted,
      totalDeleted: deletedVins.length,
      pypCount: pypResult.vehicles.length,
      row52Count: row52Result.vehicles.length,
      errors: allErrors,
      durationMs,
    };
  } catch (error) {
    const msg = `Ingestion run failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);

    // Update run record with error
    await db
      .update(ingestionRun)
      .set({
        status: "error",
        errors: JSON.stringify(allErrors),
        completedAt: new Date(),
      })
      .where(eq(ingestionRun.id, runId));

    throw error;
  }
}
