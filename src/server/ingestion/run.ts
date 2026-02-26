import { and, eq, gte, inArray, lt } from "drizzle-orm";
import pLimit from "p-limit";
import { db } from "~/lib/db";
import { ingestionRun, vehicle } from "~/schema";
import { fetchPypInventory } from "./pyp-connector";
import { fetchRow52Inventory } from "./row52-connector";
import { syncToAlgolia } from "./sync-algolia";
import type { AlgoliaVehicleRecord, CanonicalVehicle } from "./types";
import { toAlgoliaRecord } from "./types";

const UPSERT_BATCH_SIZE = 1000;
const UPSERT_SQL_VALUES_CHUNK_SIZE = 25;
const VIN_QUERY_CHUNK_SIZE = 400;
const RUN_LOCK_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const MISSING_DELETE_AFTER_RUNS = 3;
const MISSING_DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const EMPTY_TIMINGS = {
  sourcesParallelMs: 0,
  row52FetchMs: 0,
  pypFetchMs: 0,
  upsertFlushMs: 0,
  staleDeleteMs: 0,
  algoliaPrepMs: 0,
  algoliaSyncMs: 0,
};

/**
 * Upsert a batch of vehicles into Turso via Drizzle.
 * Preserves firstSeenAt for existing records, sets it to runTimestamp for new ones.
 */
async function upsertBatch(
  vehicles: CanonicalVehicle[],
  runTimestamp: Date,
): Promise<void> {
  if (vehicles.length === 0) return;

  for (
    let index = 0;
    index < vehicles.length;
    index += UPSERT_SQL_VALUES_CHUNK_SIZE
  ) {
    const batchChunk = vehicles.slice(
      index,
      index + UPSERT_SQL_VALUES_CHUNK_SIZE,
    );

    for (const v of batchChunk) {
      await db
        .insert(vehicle)
        .values({
          vin: v.vin,
          source: v.source,
          year: v.year,
          make: v.make,
          model: v.model,
          color: v.color,
          stockNumber: v.stockNumber,
          imageUrl: v.imageUrl,
          availableDate: v.availableDate,
          locationCode: v.locationCode,
          locationName: v.locationName,
          state: v.state,
          stateAbbr: v.stateAbbr,
          lat: v.lat,
          lng: v.lng,
          section: v.section,
          row: v.row,
          space: v.space,
          detailsUrl: v.detailsUrl,
          partsUrl: v.partsUrl,
          pricesUrl: v.pricesUrl,
          engine: v.engine,
          trim: v.trim,
          transmission: v.transmission,
          firstSeenAt: runTimestamp,
          lastSeenAt: runTimestamp,
          missingSinceAt: null,
          missingRunCount: 0,
        })
        .onConflictDoUpdate({
          target: vehicle.vin,
          set: {
            source: v.source,
            year: v.year,
            make: v.make,
            model: v.model,
            color: v.color,
            stockNumber: v.stockNumber,
            imageUrl: v.imageUrl,
            availableDate: v.availableDate,
            locationCode: v.locationCode,
            locationName: v.locationName,
            state: v.state,
            stateAbbr: v.stateAbbr,
            lat: v.lat,
            lng: v.lng,
            section: v.section,
            row: v.row,
            space: v.space,
            detailsUrl: v.detailsUrl,
            partsUrl: v.partsUrl,
            pricesUrl: v.pricesUrl,
            engine: v.engine,
            trim: v.trim,
            transmission: v.transmission,
            lastSeenAt: runTimestamp,
            missingSinceAt: null,
            missingRunCount: 0,
          },
        });
    }
  }
}

/**
 * Streaming upsert callback — upserts vehicles to Turso as they arrive
 * from each connector page, in batches of UPSERT_BATCH_SIZE.
 */
function createBatchUpserter(runTimestamp: Date) {
  let totalUpserted = 0;
  let buffer: CanonicalVehicle[] = [];
  const touchedVins = new Set<string>();

  return {
    /** Add vehicles to the buffer and flush when full. */
    async add(vehicles: CanonicalVehicle[]): Promise<void> {
      for (const vehicle of vehicles) {
        touchedVins.add(vehicle.vin);
      }
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
    getTouchedVins(): string[] {
      return [...touchedVins];
    },
  };
}

interface MissingTransitionResult {
  deletedVins: string[];
  missingUpdatedVins: string[];
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * Transition stale vehicles through a "missing" state before deletion.
 *
 * Rules:
 * - Vehicles seen in this run are reset in the upsert path.
 * - If source data is incomplete (errors), we DO NOT advance missing/deletion.
 * - Vehicles are deleted only after 3 missing runs OR 3 days missing.
 */
async function transitionMissingVehicles(
  runTimestamp: Date,
  allowAdvanceMissingState: boolean,
): Promise<MissingTransitionResult> {
  if (!allowAdvanceMissingState) {
    console.warn(
      "[Ingestion] Skipping missing-state advancement and deletions because one or more sources errored",
    );
    return { deletedVins: [], missingUpdatedVins: [] };
  }

  const missingSinceCutoff = new Date(
    runTimestamp.getTime() - MISSING_DELETE_AFTER_MS,
  );
  const missingCandidates = await db
    .select({
      vin: vehicle.vin,
      missingSinceAt: vehicle.missingSinceAt,
      missingRunCount: vehicle.missingRunCount,
    })
    .from(vehicle)
    .where(lt(vehicle.lastSeenAt, runTimestamp));
  const missingCandidateVins = missingCandidates.map(
    (candidate) => candidate.vin,
  );

  if (missingCandidateVins.length > 0) {
    const missingSinceUnsetVins: string[] = [];
    const incrementGroups = new Map<number, string[]>();
    const staleVins: string[] = [];

    for (const candidate of missingCandidates) {
      const nextRunCount = (candidate.missingRunCount ?? 0) + 1;
      const existingGroup = incrementGroups.get(nextRunCount);
      if (existingGroup) {
        existingGroup.push(candidate.vin);
      } else {
        incrementGroups.set(nextRunCount, [candidate.vin]);
      }

      const effectiveMissingSinceAt = candidate.missingSinceAt ?? runTimestamp;
      if (candidate.missingSinceAt === null) {
        missingSinceUnsetVins.push(candidate.vin);
      }

      if (
        nextRunCount >= MISSING_DELETE_AFTER_RUNS ||
        effectiveMissingSinceAt <= missingSinceCutoff
      ) {
        staleVins.push(candidate.vin);
      }
    }

    for (const vinChunk of splitIntoChunks(
      missingSinceUnsetVins,
      VIN_QUERY_CHUNK_SIZE,
    )) {
      await db
        .update(vehicle)
        .set({ missingSinceAt: runTimestamp })
        .where(inArray(vehicle.vin, vinChunk));
    }

    for (const [nextRunCount, vins] of incrementGroups) {
      for (const vinChunk of splitIntoChunks(vins, VIN_QUERY_CHUNK_SIZE)) {
        await db
          .update(vehicle)
          .set({ missingRunCount: nextRunCount })
          .where(inArray(vehicle.vin, vinChunk));
      }
    }

    if (staleVins.length > 0) {
      for (const vinChunk of splitIntoChunks(staleVins, VIN_QUERY_CHUNK_SIZE)) {
        await db.delete(vehicle).where(inArray(vehicle.vin, vinChunk));
      }
      console.log(`[Ingestion] Deleted ${staleVins.length} stale vehicles`);
    }

    const deletedVinSet = new Set(staleVins);
    const missingUpdatedVins = missingCandidateVins.filter(
      (vin) => !deletedVinSet.has(vin),
    );

    return { deletedVins: staleVins, missingUpdatedVins };
  }
  return { deletedVins: [], missingUpdatedVins: [] };
}

/**
 * Lock ingestion using an atomic insert-if-not-exists on ingestion_run.
 * Returns false when another active run already exists inside lock timeout.
 */
async function acquireIngestionLock(
  runId: string,
  runTimestamp: Date,
): Promise<boolean> {
  const lockCutoff = new Date(runTimestamp.getTime() - RUN_LOCK_TIMEOUT_MS);

  return db.transaction(async (tx) => {
    const [activeRun] = await tx
      .select({ id: ingestionRun.id })
      .from(ingestionRun)
      .where(
        and(
          eq(ingestionRun.status, "running"),
          gte(ingestionRun.startedAt, lockCutoff),
        ),
      )
      .limit(1);

    if (activeRun) {
      return false;
    }

    await tx.insert(ingestionRun).values({
      id: runId,
      source: "all",
      status: "running",
      startedAt: runTimestamp,
    });

    return true;
  });
}

function mapDbVehicleToAlgoliaRecord(
  dbVehicle: typeof vehicle.$inferSelect,
): AlgoliaVehicleRecord {
  return toAlgoliaRecord(
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
    dbVehicle.missingSinceAt,
    dbVehicle.missingRunCount ?? 0,
  );
}

async function fetchAlgoliaRecordsForVins(
  vins: string[],
): Promise<AlgoliaVehicleRecord[]> {
  if (vins.length === 0) return [];

  const uniqueVins = [...new Set(vins)];
  const records: AlgoliaVehicleRecord[] = [];

  for (
    let index = 0;
    index < uniqueVins.length;
    index += VIN_QUERY_CHUNK_SIZE
  ) {
    const vinChunk = uniqueVins.slice(index, index + VIN_QUERY_CHUNK_SIZE);
    const rows = await db
      .select()
      .from(vehicle)
      .where(inArray(vehicle.vin, vinChunk));

    for (const row of rows) {
      records.push(mapDbVehicleToAlgoliaRecord(row));
    }
  }

  return records;
}

/**
 * Run the full ingestion pipeline:
 * 1. Fetch from Row52 + PYP in parallel
 * 2. Serialize all DB writes through a single queue
 * 3. Advance missing state and delete records beyond threshold
 * 4. Sync changed records to Algolia
 */
export async function runIngestion(): Promise<{
  totalUpserted: number;
  totalDeleted: number;
  pypCount: number;
  row52Count: number;
  errors: string[];
  durationMs: number;
  timingsMs: {
    sourcesParallelMs: number;
    row52FetchMs: number;
    pypFetchMs: number;
    upsertFlushMs: number;
    staleDeleteMs: number;
    algoliaPrepMs: number;
    algoliaSyncMs: number;
  };
}> {
  const startTime = Date.now();
  const runTimestamp = new Date();
  const runId = crypto.randomUUID();
  const allErrors: string[] = [];

  console.log(
    `[Ingestion] Starting run ${runId} at ${runTimestamp.toISOString()}`,
  );

  const lockAcquired = await acquireIngestionLock(runId, runTimestamp);
  if (!lockAcquired) {
    const durationMs = Date.now() - startTime;
    const msg = `[Ingestion] Skipping run ${runId}: another ingestion run is already active`;
    console.warn(msg);
    return {
      totalUpserted: 0,
      totalDeleted: 0,
      pypCount: 0,
      row52Count: 0,
      errors: [msg],
      durationMs,
      timingsMs: EMPTY_TIMINGS,
    };
  }

  try {
    const upserter = createBatchUpserter(runTimestamp);
    const writeQueue = pLimit(1);

    let row52FetchMs = 0;
    let pypFetchMs = 0;

    const sourcesStart = Date.now();

    // 1. Fetch both sources in parallel while serializing writes.
    const row52Promise = (async () => {
      const startedAt = Date.now();
      try {
        return await fetchRow52Inventory(async (vehicles) => {
          await writeQueue(() => upserter.add(vehicles));
        });
      } catch (error) {
        const msg = `Row52 ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        return {
          source: "row52" as const,
          vehicles: [] as CanonicalVehicle[],
          count: 0,
          errors: [msg],
        };
      } finally {
        row52FetchMs = Date.now() - startedAt;
      }
    })();

    const pypPromise = (async () => {
      const startedAt = Date.now();
      try {
        return await fetchPypInventory(async (vehicles) => {
          await writeQueue(() => upserter.add(vehicles));
        });
      } catch (error) {
        const msg = `PYP ingestion failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        return {
          source: "pyp" as const,
          vehicles: [] as CanonicalVehicle[],
          count: 0,
          errors: [msg],
        };
      } finally {
        pypFetchMs = Date.now() - startedAt;
      }
    })();

    const [row52Result, pypResult] = await Promise.all([
      row52Promise,
      pypPromise,
    ]);
    const sourcesParallelMs = Date.now() - sourcesStart;

    allErrors.push(...row52Result.errors);
    allErrors.push(...pypResult.errors);

    // Flush remaining buffered vehicles after all queued writes complete.
    const flushStartedAt = Date.now();
    await writeQueue(() => upserter.flush());
    const upsertFlushMs = Date.now() - flushStartedAt;

    console.log(
      `[Ingestion] PYP: ${pypResult.count} vehicles, Row52: ${row52Result.count} vehicles`,
    );
    console.log(`[Ingestion] Upserted ${upserter.count} vehicles to Turso`);
    console.log(
      `[Ingestion] Source timings: row52=${row52FetchMs}ms pyp=${pypFetchMs}ms parallel_window=${sourcesParallelMs}ms`,
    );

    const hasSourceErrors =
      row52Result.errors.length > 0 || pypResult.errors.length > 0;

    // 3. Advance missing-state and conditionally delete stale records
    const staleDeleteStartedAt = Date.now();
    const missingTransition = await transitionMissingVehicles(
      runTimestamp,
      !hasSourceErrors,
    );
    const deletedVins = missingTransition.deletedVins;
    const staleDeleteMs = Date.now() - staleDeleteStartedAt;

    // 4. Build Algolia records for touched VINs + missing-state changes
    const algoliaPrepStartedAt = Date.now();
    const touchedVins = [
      ...upserter.getTouchedVins(),
      ...missingTransition.missingUpdatedVins,
    ];
    const algoliaRecords = await fetchAlgoliaRecordsForVins(touchedVins);
    const algoliaPrepMs = Date.now() - algoliaPrepStartedAt;
    console.log(
      `[Ingestion] Algolia prep: touched_vins=${touchedVins.length}, records_loaded=${algoliaRecords.length}`,
    );

    // 5. Sync to Algolia
    const algoliaSyncStartedAt = Date.now();
    await syncToAlgolia(algoliaRecords, deletedVins, {
      configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
    });
    const algoliaSyncMs = Date.now() - algoliaSyncStartedAt;

    const durationMs = Date.now() - startTime;
    const timingsMs = {
      sourcesParallelMs,
      row52FetchMs,
      pypFetchMs,
      upsertFlushMs,
      staleDeleteMs,
      algoliaPrepMs,
      algoliaSyncMs,
    };

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
    console.log(
      `[Ingestion] Stage timings: flush=${upsertFlushMs}ms stale_delete=${staleDeleteMs}ms algolia_prep=${algoliaPrepMs}ms algolia_sync=${algoliaSyncMs}ms`,
    );

    return {
      totalUpserted: upserter.count,
      totalDeleted: deletedVins.length,
      pypCount: pypResult.count,
      row52Count: row52Result.count,
      errors: allErrors,
      durationMs,
      timingsMs,
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
