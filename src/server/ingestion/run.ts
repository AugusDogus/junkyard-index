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
 * Upsert a batch of vehicles into Turso using raw SQL for ON CONFLICT.
 * Preserves firstSeenAt for existing records, sets it to runTimestamp for new ones.
 */
async function upsertBatch(
  vehicles: CanonicalVehicle[],
  runTimestamp: Date,
): Promise<void> {
  if (vehicles.length === 0) return;

  const statements = vehicles.map((v) =>
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
  );

  await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
}

/**
 * Streaming upsert callback — upserts vehicles to Turso as they arrive
 * from each connector page, in batches of UPSERT_BATCH_SIZE.
 */
function createBatchUpserter(runTimestamp: Date) {
  let totalUpserted = 0;
  let buffer: CanonicalVehicle[] = [];

  return {
    /** Add vehicles to the buffer and flush when full. */
    async add(vehicles: CanonicalVehicle[]): Promise<void> {
      buffer.push(...vehicles);

      while (buffer.length >= UPSERT_BATCH_SIZE) {
        const batch = buffer.splice(0, UPSERT_BATCH_SIZE);
        await upsertBatch(batch, runTimestamp);
        totalUpserted += batch.length;

        if (totalUpserted % 5000 === 0) {
          console.log(`[Ingestion] Upserted ${totalUpserted} vehicles so far`);
        }
      }
    },
    /** Flush any remaining vehicles in the buffer. */
    async flush(): Promise<void> {
      if (buffer.length > 0) {
        await upsertBatch(buffer, runTimestamp);
        totalUpserted += buffer.length;
        buffer = [];
      }
    },
    get count() {
      return totalUpserted;
    },
  };
}

/**
 * Delete stale vehicles (those not seen in this run) and return their VINs.
 */
async function deleteStaleVehicles(runTimestamp: Date): Promise<string[]> {
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
 * 1. Fetch from Row52 first (lower priority), streaming upserts to Turso
 * 2. Fetch from PYP second (higher priority — overwrites Row52 dupes via ON CONFLICT)
 * 3. Delete stale records
 * 4. Sync all vehicles to Algolia
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

  console.log(
    `[Ingestion] Starting run ${runId} at ${runTimestamp.toISOString()}`,
  );

  // Record run start
  await db.insert(ingestionRun).values({
    id: runId,
    source: "all",
    status: "running",
    startedAt: runTimestamp,
  });

  try {
    const upserter = createBatchUpserter(runTimestamp);

    // 1. Row52 first (lower priority — PYP will overwrite dupes)
    const row52Result = await fetchRow52Inventory(async (vehicles) => {
      await upserter.add(vehicles);
    }).catch((error) => {
      const msg = `Row52 ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(msg);
      return {
        source: "row52" as const,
        vehicles: [] as CanonicalVehicle[],
        count: 0,
        errors: [msg],
      };
    });
    allErrors.push(...row52Result.errors);

    // 2. PYP second (higher priority — overwrites Row52 dupes)
    const pypResult = await fetchPypInventory(async (vehicles) => {
      await upserter.add(vehicles);
    }).catch((error) => {
      const msg = `PYP ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(msg);
      return {
        source: "pyp" as const,
        vehicles: [] as CanonicalVehicle[],
        count: 0,
        errors: [msg],
      };
    });
    allErrors.push(...pypResult.errors);

    // Flush any remaining buffered vehicles
    await upserter.flush();

    console.log(
      `[Ingestion] PYP: ${pypResult.count} vehicles, Row52: ${row52Result.count} vehicles`,
    );
    console.log(`[Ingestion] Upserted ${upserter.count} vehicles to Turso`);

    // 3. Delete stale records
    const deletedVins = await deleteStaleVehicles(runTimestamp);

    // 4. Build Algolia records from DB (to get accurate firstSeenAt)
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

    // 5. Sync to Algolia
    await syncToAlgolia(algoliaRecords, deletedVins);

    const durationMs = Date.now() - startTime;

    // Update run record
    await db
      .update(ingestionRun)
      .set({
        status: "success",
        vehiclesUpserted: upserter.count,
        vehiclesDeleted: deletedVins.length,
        errors: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
        completedAt: new Date(),
      })
      .where(eq(ingestionRun.id, runId));

    console.log(
      `[Ingestion] Run complete in ${durationMs}ms: ${upserter.count} upserted, ${deletedVins.length} deleted`,
    );

    return {
      totalUpserted: upserter.count,
      totalDeleted: deletedVins.length,
      pypCount: pypResult.count,
      row52Count: row52Result.count,
      errors: allErrors,
      durationMs,
    };
  } catch (error) {
    const msg = `Ingestion run failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);

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
