import { eq, lt, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { db } from "~/lib/db";
import { ingestionRun, vehicle } from "~/schema";
import {
  fetchPypInventory,
  fetchPypInventoryChunk,
  type PypChunkResult,
} from "./pyp-connector";
import {
  fetchRow52Inventory,
  fetchRow52InventoryChunk,
  type Row52ChunkResult,
} from "./row52-connector";
import { syncToAlgolia } from "./sync-algolia";
import type { AlgoliaVehicleRecord, CanonicalVehicle } from "./types";
import { toAlgoliaRecord } from "./types";

const UPSERT_BATCH_SIZE = 1000;
const UPSERT_SQL_VALUES_CHUNK_SIZE = 25;
const VIN_QUERY_CHUNK_SIZE = 400;
const RUN_LOCK_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const ROW52_PAGES_PER_STEP = 2;
const PYP_PAGES_PER_STEP = 3;

const EMPTY_TIMINGS = {
  sourcesParallelMs: 0,
  row52FetchMs: 0,
  pypFetchMs: 0,
  upsertFlushMs: 0,
  staleDeleteMs: 0,
  algoliaPrepMs: 0,
  algoliaSyncMs: 0,
};

export interface IngestionContinuationState {
  cycleId: string;
  cycleStartedAtMs: number;
  row52Skip: number;
  row52TotalCount?: number;
  row52Done: boolean;
  pypPage: number;
  pypDone: boolean;
  totalUpserted: number;
}

export interface IngestionStepResult {
  status: "in_progress" | "completed" | "skipped" | "error";
  state?: IngestionContinuationState;
  totalUpserted: number;
  totalDeleted: number;
  pypCount: number;
  row52Count: number;
  errors: string[];
  durationMs: number;
  timingsMs: typeof EMPTY_TIMINGS;
}

/**
 * Upsert a batch of vehicles into Turso using raw SQL for ON CONFLICT.
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
    const sqlChunk = vehicles.slice(
      index,
      index + UPSERT_SQL_VALUES_CHUNK_SIZE,
    );
    const valuesSql = sql.join(
      sqlChunk.map(
        (v) => sql`(
        ${v.vin}, ${v.source}, ${v.year}, ${v.make}, ${v.model}, ${v.color},
        ${v.stockNumber}, ${v.imageUrl}, ${v.availableDate}, ${v.locationCode},
        ${v.locationName}, ${v.state}, ${v.stateAbbr}, ${v.lat}, ${v.lng},
        ${v.section}, ${v.row}, ${v.space}, ${v.detailsUrl}, ${v.partsUrl},
        ${v.pricesUrl}, ${v.engine}, ${v.trim}, ${v.transmission},
        ${runTimestamp.getTime()}, ${runTimestamp.getTime()}
      )`,
      ),
      sql`, `,
    );

    await db.run(sql`INSERT INTO vehicle (
        vin, source, year, make, model, color, stock_number, image_url,
        available_date, location_code, location_name, state, state_abbr,
        lat, lng, section, row, space, details_url, parts_url, prices_url,
        engine, trim, transmission, first_seen_at, last_seen_at
      ) VALUES ${valuesSql}
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
        last_seen_at = excluded.last_seen_at`);
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
 * Lock ingestion using an atomic insert-if-not-exists on ingestion_run.
 * Returns false when another active run already exists inside lock timeout.
 */
async function acquireIngestionLock(
  runId: string,
  runTimestamp: Date,
): Promise<boolean> {
  const lockCutoffMs = runTimestamp.getTime() - RUN_LOCK_TIMEOUT_MS;

  await db.run(sql`
    INSERT INTO ingestion_run (id, source, status, started_at)
    SELECT ${runId}, ${"all"}, ${"running"}, ${runTimestamp.getTime()}
    WHERE NOT EXISTS (
      SELECT 1
      FROM ingestion_run
      WHERE status = ${"running"}
        AND started_at >= ${lockCutoffMs}
    )
  `);

  const [insertedRun] = await db
    .select({ id: ingestionRun.id })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, runId))
    .limit(1);

  return insertedRun !== undefined;
}

async function isIngestionRunActive(runId: string): Promise<boolean> {
  const [runningRun] = await db
    .select({ id: ingestionRun.id, status: ingestionRun.status })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, runId))
    .limit(1);
  return runningRun?.status === "running";
}

async function markIngestionRunSuccess(
  runId: string,
  vehiclesUpserted: number,
  vehiclesDeleted: number,
  errors: string[],
): Promise<void> {
  await db
    .update(ingestionRun)
    .set({
      status: "success",
      vehiclesUpserted,
      vehiclesDeleted,
      errors: errors.length > 0 ? JSON.stringify(errors) : null,
      completedAt: new Date(),
    })
    .where(eq(ingestionRun.id, runId));
}

async function markIngestionRunError(
  runId: string,
  errors: string[],
): Promise<void> {
  await db
    .update(ingestionRun)
    .set({
      status: "error",
      errors: JSON.stringify(errors),
      completedAt: new Date(),
    })
    .where(eq(ingestionRun.id, runId));
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
    const vinList = sql.join(
      vinChunk.map((vin) => sql`${vin}`),
      sql`, `,
    );
    const rows = await db
      .select()
      .from(vehicle)
      .where(sql`${vehicle.vin} IN (${vinList})`);

    for (const row of rows) {
      records.push(mapDbVehicleToAlgoliaRecord(row));
    }
  }

  return records;
}

function createInitialContinuationState(): IngestionContinuationState {
  return {
    cycleId: crypto.randomUUID(),
    cycleStartedAtMs: Date.now(),
    row52Skip: 0,
    row52Done: false,
    pypPage: 1,
    pypDone: false,
    totalUpserted: 0,
  };
}

export async function runIngestionStep(
  providedState?: IngestionContinuationState,
): Promise<IngestionStepResult> {
  const startTime = Date.now();
  const allErrors: string[] = [];
  const state = providedState ?? createInitialContinuationState();
  const cycleTimestamp = new Date(state.cycleStartedAtMs);
  const isInitialStep = providedState === undefined;

  if (isInitialStep) {
    const lockAcquired = await acquireIngestionLock(
      state.cycleId,
      cycleTimestamp,
    );
    if (!lockAcquired) {
      const msg = `[Ingestion] Skipping cycle start ${state.cycleId}: another ingestion run is already active`;
      console.warn(msg);
      return {
        status: "skipped",
        totalUpserted: 0,
        totalDeleted: 0,
        pypCount: 0,
        row52Count: 0,
        errors: [msg],
        durationMs: Date.now() - startTime,
        timingsMs: EMPTY_TIMINGS,
      };
    }
  } else {
    const isActive = await isIngestionRunActive(state.cycleId);
    if (!isActive) {
      const msg = `[Ingestion] Cycle ${state.cycleId} is not active; skipping continuation`;
      console.warn(msg);
      return {
        status: "skipped",
        totalUpserted: state.totalUpserted,
        totalDeleted: 0,
        pypCount: 0,
        row52Count: 0,
        errors: [msg],
        durationMs: Date.now() - startTime,
        timingsMs: EMPTY_TIMINGS,
      };
    }
  }

  try {
    const upserter = createBatchUpserter(cycleTimestamp);
    const writeQueue = pLimit(1);

    const row52StartedAt = Date.now();
    const row52Promise: Promise<Row52ChunkResult | null> = state.row52Done
      ? Promise.resolve(null)
      : fetchRow52InventoryChunk({
          startSkip: state.row52Skip,
          knownTotalCount: state.row52TotalCount,
          maxPages: ROW52_PAGES_PER_STEP,
          onBatch: async (vehicles) => {
            await writeQueue(() => upserter.add(vehicles));
          },
        });

    const pypStartedAt = Date.now();
    const pypPromise: Promise<PypChunkResult | null> = state.pypDone
      ? Promise.resolve(null)
      : fetchPypInventoryChunk({
          startPage: state.pypPage,
          maxPages: PYP_PAGES_PER_STEP,
          onBatch: async (vehicles) => {
            await writeQueue(() => upserter.add(vehicles));
          },
        });

    const [row52Chunk, pypChunk] = await Promise.all([
      row52Promise,
      pypPromise,
    ]);
    const row52FetchMs = state.row52Done ? 0 : Date.now() - row52StartedAt;
    const pypFetchMs = state.pypDone ? 0 : Date.now() - pypStartedAt;
    const sourcesParallelMs = Math.max(row52FetchMs, pypFetchMs);

    if (row52Chunk) allErrors.push(...row52Chunk.errors);
    if (pypChunk) allErrors.push(...pypChunk.errors);

    const flushStartedAt = Date.now();
    await writeQueue(() => upserter.flush());
    const upsertFlushMs = Date.now() - flushStartedAt;

    const touchedVins = upserter.getTouchedVins();
    const algoliaPrepStartedAt = Date.now();
    const algoliaRecords = await fetchAlgoliaRecordsForVins(touchedVins);
    const algoliaPrepMs = Date.now() - algoliaPrepStartedAt;

    const algoliaSyncStartedAt = Date.now();
    await syncToAlgolia(algoliaRecords, [], {
      configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
    });
    const algoliaSyncMs = Date.now() - algoliaSyncStartedAt;

    const nextState: IngestionContinuationState = {
      ...state,
      totalUpserted: state.totalUpserted + upserter.count,
      row52Skip: row52Chunk ? row52Chunk.nextSkip : state.row52Skip,
      row52Done: row52Chunk ? row52Chunk.done : state.row52Done,
      row52TotalCount: row52Chunk?.totalCount ?? state.row52TotalCount,
      pypPage: pypChunk ? pypChunk.nextPage : state.pypPage,
      pypDone: pypChunk ? pypChunk.done : state.pypDone,
    };

    const timingsMs = {
      sourcesParallelMs,
      row52FetchMs,
      pypFetchMs,
      upsertFlushMs,
      staleDeleteMs: 0,
      algoliaPrepMs,
      algoliaSyncMs,
    };

    if (allErrors.length > 0) {
      await markIngestionRunError(state.cycleId, allErrors);
      return {
        status: "error",
        totalUpserted: nextState.totalUpserted,
        totalDeleted: 0,
        pypCount: pypChunk?.count ?? 0,
        row52Count: row52Chunk?.count ?? 0,
        errors: allErrors,
        durationMs: Date.now() - startTime,
        timingsMs,
      };
    }

    console.log(
      `[Ingestion] Step for cycle ${state.cycleId}: row52_count=${row52Chunk?.count ?? 0}, pyp_count=${pypChunk?.count ?? 0}, touched_vins=${touchedVins.length}, total_upserted=${nextState.totalUpserted}`,
    );

    if (nextState.row52Done && nextState.pypDone) {
      const staleDeleteStartedAt = Date.now();
      const deletedVins = await deleteStaleVehicles(cycleTimestamp);
      const staleDeleteMs = Date.now() - staleDeleteStartedAt;

      const finalizeSyncStartedAt = Date.now();
      await syncToAlgolia([], deletedVins, {
        configureIndex: process.env.ALGOLIA_CONFIGURE_ON_INGEST === "1",
      });
      const finalizeSyncMs = Date.now() - finalizeSyncStartedAt;

      await markIngestionRunSuccess(
        state.cycleId,
        nextState.totalUpserted,
        deletedVins.length,
        [],
      );

      return {
        status: "completed",
        totalUpserted: nextState.totalUpserted,
        totalDeleted: deletedVins.length,
        pypCount: pypChunk?.count ?? 0,
        row52Count: row52Chunk?.count ?? 0,
        errors: [],
        durationMs: Date.now() - startTime,
        timingsMs: {
          ...timingsMs,
          staleDeleteMs,
          algoliaSyncMs: timingsMs.algoliaSyncMs + finalizeSyncMs,
        },
      };
    }

    return {
      status: "in_progress",
      state: nextState,
      totalUpserted: nextState.totalUpserted,
      totalDeleted: 0,
      pypCount: pypChunk?.count ?? 0,
      row52Count: row52Chunk?.count ?? 0,
      errors: [],
      durationMs: Date.now() - startTime,
      timingsMs,
    };
  } catch (error) {
    const msg = `Ingestion step failed: ${error instanceof Error ? error.message : String(error)}`;
    allErrors.push(msg);
    console.error(msg);
    await markIngestionRunError(state.cycleId, allErrors);
    return {
      status: "error",
      totalUpserted: state.totalUpserted,
      totalDeleted: 0,
      pypCount: 0,
      row52Count: 0,
      errors: allErrors,
      durationMs: Date.now() - startTime,
      timingsMs: EMPTY_TIMINGS,
    };
  }
}

/**
 * Run the full ingestion pipeline:
 * 1. Fetch from Row52 + PYP in parallel
 * 2. Serialize all DB writes through a single queue
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

    // 3. Delete stale records
    const staleDeleteStartedAt = Date.now();
    const deletedVins = await deleteStaleVehicles(runTimestamp);
    const staleDeleteMs = Date.now() - staleDeleteStartedAt;

    // 4. Build Algolia records only for touched VINs
    const algoliaPrepStartedAt = Date.now();
    const touchedVins = upserter.getTouchedVins();
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
