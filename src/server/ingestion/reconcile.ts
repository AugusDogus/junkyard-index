import { Effect } from "effect";
import { asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { vehicle, vehicleChange } from "~/schema";
import { PersistenceError } from "./errors";
import { Database } from "./runtime";
import type { CanonicalVehicle } from "./types";

type SourceName = CanonicalVehicle["source"];
type ExistingVehicleRow = typeof vehicle.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const VEHICLE_UPSERT_CHUNK_SIZE = 500;
const VEHICLE_CHANGE_CHUNK_SIZE = 1_000;
const VIN_DELETE_CHUNK_SIZE = 500;
const EXISTING_VEHICLE_LOOKUP_CHUNK_SIZE = 1_000;
const MISSING_SCAN_CHUNK_SIZE = 5_000;

interface ReconcileOptions {
  runId: string;
  runTimestamp: Date;
  finalInventoryByVin: ReadonlyMap<string, CanonicalVehicle>;
  allowAdvanceMissingState: boolean;
  missingDeleteAfterRuns: number;
  missingDeleteAfterMs: number;
}

export interface ReconcileResult {
  upsertedCount: number;
  deletedCount: number;
  missingUpdatedCount: number;
  skippedMissingAdvance: boolean;
  timingsMs: {
    readExistingMs: number;
    planMs: number;
    upsertWriteMs: number;
    missingWriteMs: number;
  };
}

interface PlannedVehicleUpsert {
  vehicle: CanonicalVehicle;
  firstSeenAt: Date;
}

interface MissingTransition {
  vin: string;
  changeType: "missing" | "delete";
  missingSinceAt: Date;
  missingRunCount: number;
}

interface MissingStateRow {
  vin: string;
  missingSinceAt: Date | null;
  missingRunCount: number | null;
}

interface ReconcilePlan {
  upsertedCount: number;
  changedUpserts: PlannedVehicleUpsert[];
  missingTransitions: MissingTransition[];
  deleteVins: string[];
  skippedMissingAdvance: boolean;
}

export function buildFinalInventoryByVin(params: {
  healthySources: SourceName[];
  row52ByVin: Map<string, CanonicalVehicle>;
  pypByVin: Map<string, CanonicalVehicle>;
}): Map<string, CanonicalVehicle> {
  const row52Healthy = params.healthySources.includes("row52");
  const pypHealthy = params.healthySources.includes("pyp");

  if (row52Healthy && pypHealthy) {
    // Keep the larger Row52 map as the working set so we avoid allocating a
    // third VIN map and also minimize merge churn. Row52 still wins on shared
    // VINs by only filling holes from PYP.
    for (const [vin, vehicle] of params.pypByVin) {
      if (!params.row52ByVin.has(vin)) {
        params.row52ByVin.set(vin, vehicle);
      }
    }
    params.pypByVin.clear();
    return params.row52ByVin;
  }

  if (row52Healthy) {
    params.pypByVin.clear();
    return params.row52ByVin;
  }

  if (pypHealthy) {
    params.row52ByVin.clear();
    return params.pypByVin;
  }

  params.row52ByVin.clear();
  params.pypByVin.clear();
  return new Map<string, CanonicalVehicle>();
}

function vehicleNeedsUpsert(
  existingVehicle: ExistingVehicleRow | undefined,
  nextVehicle: CanonicalVehicle,
): boolean {
  if (!existingVehicle) {
    return true;
  }

  return (
    existingVehicle.source !== nextVehicle.source ||
    existingVehicle.year !== nextVehicle.year ||
    existingVehicle.make !== nextVehicle.make ||
    existingVehicle.model !== nextVehicle.model ||
    existingVehicle.color !== nextVehicle.color ||
    existingVehicle.stockNumber !== nextVehicle.stockNumber ||
    existingVehicle.imageUrl !== nextVehicle.imageUrl ||
    existingVehicle.availableDate !== nextVehicle.availableDate ||
    existingVehicle.locationCode !== nextVehicle.locationCode ||
    existingVehicle.locationName !== nextVehicle.locationName ||
    existingVehicle.state !== nextVehicle.state ||
    existingVehicle.stateAbbr !== nextVehicle.stateAbbr ||
    existingVehicle.lat !== nextVehicle.lat ||
    existingVehicle.lng !== nextVehicle.lng ||
    existingVehicle.section !== nextVehicle.section ||
    existingVehicle.row !== nextVehicle.row ||
    existingVehicle.space !== nextVehicle.space ||
    existingVehicle.detailsUrl !== nextVehicle.detailsUrl ||
    existingVehicle.partsUrl !== nextVehicle.partsUrl ||
    existingVehicle.pricesUrl !== nextVehicle.pricesUrl ||
    existingVehicle.engine !== nextVehicle.engine ||
    existingVehicle.trim !== nextVehicle.trim ||
    existingVehicle.transmission !== nextVehicle.transmission ||
    existingVehicle.missingSinceAt !== null ||
    (existingVehicle.missingRunCount ?? 0) !== 0
  );
}

export function createReconcilePlan(params: {
  finalInventoryByVin: ReadonlyMap<string, CanonicalVehicle>;
  existingVehicles: ExistingVehicleRow[];
  runTimestamp: Date;
  allowAdvanceMissingState: boolean;
  missingDeleteAfterRuns: number;
  missingDeleteAfterMs: number;
}): ReconcilePlan {
  const existingByVin = new Map<string, ExistingVehicleRow>();
  for (const existingVehicle of params.existingVehicles) {
    existingByVin.set(existingVehicle.vin, existingVehicle);
  }

  const changedUpserts: PlannedVehicleUpsert[] = [];
  for (const [vin, nextVehicle] of params.finalInventoryByVin) {
    const existingVehicle = existingByVin.get(vin);
    if (!vehicleNeedsUpsert(existingVehicle, nextVehicle)) {
      continue;
    }

    changedUpserts.push({
      vehicle: nextVehicle,
      firstSeenAt: existingVehicle?.firstSeenAt ?? params.runTimestamp,
    });
  }

  if (!params.allowAdvanceMissingState) {
    return {
      upsertedCount: params.finalInventoryByVin.size,
      changedUpserts,
      missingTransitions: [],
      deleteVins: [],
      skippedMissingAdvance: true,
    };
  }

  const missingSinceCutoffMs =
    params.runTimestamp.getTime() - params.missingDeleteAfterMs;
  const missingTransitions: MissingTransition[] = [];
  const deleteVins: string[] = [];

  for (const existingVehicle of params.existingVehicles) {
    if (params.finalInventoryByVin.has(existingVehicle.vin)) {
      continue;
    }

    const missingSinceAt = existingVehicle.missingSinceAt ?? params.runTimestamp;
    const missingRunCount = (existingVehicle.missingRunCount ?? 0) + 1;
    const shouldDelete =
      missingRunCount >= params.missingDeleteAfterRuns ||
      missingSinceAt.getTime() <= missingSinceCutoffMs;

    if (shouldDelete) {
      deleteVins.push(existingVehicle.vin);
    }

    missingTransitions.push({
      vin: existingVehicle.vin,
      changeType: shouldDelete ? "delete" : "missing",
      missingSinceAt,
      missingRunCount,
    });
  }

  return {
    upsertedCount: params.finalInventoryByVin.size,
    changedUpserts,
    missingTransitions,
    deleteVins,
    skippedMissingAdvance: false,
  };
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function* chunkMapEntries<K, V>(
  values: ReadonlyMap<K, V>,
  chunkSize: number,
): Generator<Array<[K, V]>> {
  let chunk: Array<[K, V]> = [];

  for (const entry of values) {
    chunk.push(entry);
    if (chunk.length >= chunkSize) {
      yield chunk;
      chunk = [];
    }
  }

  if (chunk.length > 0) {
    yield chunk;
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatReconcileMemory(
  stage: string,
  details: Record<string, number | string>,
): string {
  const usage = process.memoryUsage();
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `[Ingestion] Memory ${stage}: rss=${formatMegabytes(usage.rss)} heap_used=${formatMegabytes(usage.heapUsed)} heap_total=${formatMegabytes(usage.heapTotal)} external=${formatMegabytes(usage.external)} ${detailText}`.trim();
}

function dbEffect<A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, PersistenceError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new PersistenceError({ operation, cause }),
  });
}

function dbTransactionEffect<A>(
  dbClient: typeof db,
  operation: string,
  run: (tx: DbTransaction) => Effect.Effect<A, PersistenceError>,
): Effect.Effect<A, PersistenceError> {
  return dbEffect(operation, () =>
    dbClient.transaction((tx) => Effect.runPromise(run(tx))),
  );
}

function collectChangedUpserts(params: {
  finalInventoryByVin: ReadonlyMap<string, CanonicalVehicle>;
  runTimestamp: Date;
}): Effect.Effect<
  {
  changedUpserts: PlannedVehicleUpsert[];
  readExistingMs: number;
  planMs: number;
  },
  PersistenceError,
  Database
> {
  return Effect.gen(function* () {
    const dbClient = yield* Database;
    const changedUpserts: PlannedVehicleUpsert[] = [];
    let readExistingMs = 0;
    let planMs = 0;

    for (const chunk of chunkMapEntries(
      params.finalInventoryByVin,
      EXISTING_VEHICLE_LOOKUP_CHUNK_SIZE,
    )) {
      const vins = chunk.map(([vin]) => vin);

      const readStartedAt = Date.now();
      const existingRows = yield* dbEffect("reconcile.readExistingVehicles", () =>
        dbClient.select().from(vehicle).where(inArray(vehicle.vin, vins)),
      );
      readExistingMs += Date.now() - readStartedAt;

      const planStartedAt = Date.now();
      const existingByVin = new Map<string, ExistingVehicleRow>();
      for (const existingVehicle of existingRows) {
        existingByVin.set(existingVehicle.vin, existingVehicle);
      }

      for (const [vin, nextVehicle] of chunk) {
        const existingVehicle = existingByVin.get(vin);
        if (!vehicleNeedsUpsert(existingVehicle, nextVehicle)) {
          continue;
        }

        changedUpserts.push({
          vehicle: nextVehicle,
          firstSeenAt: existingVehicle?.firstSeenAt ?? params.runTimestamp,
        });
      }
      planMs += Date.now() - planStartedAt;
    }

    return {
      changedUpserts,
      readExistingMs,
      planMs,
    };
  });
}

function collectMissingTransitions(params: {
  finalInventoryByVin: ReadonlyMap<string, CanonicalVehicle>;
  runTimestamp: Date;
  missingDeleteAfterRuns: number;
  missingDeleteAfterMs: number;
}): Effect.Effect<
  {
  missingTransitions: MissingTransition[];
  deleteVins: string[];
  readExistingMs: number;
  planMs: number;
  },
  PersistenceError,
  Database
> {
  return Effect.gen(function* () {
    const dbClient = yield* Database;
    const missingSinceCutoffMs =
      params.runTimestamp.getTime() - params.missingDeleteAfterMs;
    const missingTransitions: MissingTransition[] = [];
    const deleteVins: string[] = [];
    let readExistingMs = 0;
    let planMs = 0;
    let lastVin: string | null = null;

    while (true) {
      const readStartedAt = Date.now();
      const lastVinValue = lastVin;
      const rows: MissingStateRow[] =
        lastVinValue === null
          ? yield* dbEffect("reconcile.readMissingState.initial", () =>
              dbClient
                .select({
                  vin: vehicle.vin,
                  missingSinceAt: vehicle.missingSinceAt,
                  missingRunCount: vehicle.missingRunCount,
                })
                .from(vehicle)
                .orderBy(asc(vehicle.vin))
                .limit(MISSING_SCAN_CHUNK_SIZE),
            )
          : yield* dbEffect("reconcile.readMissingState.paginated", () =>
              dbClient
                .select({
                  vin: vehicle.vin,
                  missingSinceAt: vehicle.missingSinceAt,
                  missingRunCount: vehicle.missingRunCount,
                })
                .from(vehicle)
                .where(gt(vehicle.vin, lastVinValue))
                .orderBy(asc(vehicle.vin))
                .limit(MISSING_SCAN_CHUNK_SIZE),
            );
      readExistingMs += Date.now() - readStartedAt;

      if (rows.length === 0) {
        break;
      }

      const planStartedAt = Date.now();
      for (const existingVehicle of rows) {
        if (params.finalInventoryByVin.has(existingVehicle.vin)) {
          continue;
        }

        const missingSinceAt =
          existingVehicle.missingSinceAt ?? params.runTimestamp;
        const missingRunCount = (existingVehicle.missingRunCount ?? 0) + 1;
        const shouldDelete =
          missingRunCount >= params.missingDeleteAfterRuns ||
          missingSinceAt.getTime() <= missingSinceCutoffMs;

        if (shouldDelete) {
          deleteVins.push(existingVehicle.vin);
        }

        missingTransitions.push({
          vin: existingVehicle.vin,
          changeType: shouldDelete ? "delete" : "missing",
          missingSinceAt,
          missingRunCount,
        });
      }
      planMs += Date.now() - planStartedAt;
      lastVin = rows[rows.length - 1]?.vin ?? null;
    }

    return {
      missingTransitions,
      deleteVins,
      readExistingMs,
      planMs,
    };
  });
}

function toVehicleRow(params: {
  vehicle: CanonicalVehicle;
  firstSeenAt: Date;
  runTimestamp: Date;
}): typeof vehicle.$inferInsert {
  return {
    vin: params.vehicle.vin,
    source: params.vehicle.source,
    year: params.vehicle.year,
    make: params.vehicle.make,
    model: params.vehicle.model,
    color: params.vehicle.color,
    stockNumber: params.vehicle.stockNumber,
    imageUrl: params.vehicle.imageUrl,
    availableDate: params.vehicle.availableDate,
    locationCode: params.vehicle.locationCode,
    locationName: params.vehicle.locationName,
    state: params.vehicle.state,
    stateAbbr: params.vehicle.stateAbbr,
    lat: params.vehicle.lat,
    lng: params.vehicle.lng,
    section: params.vehicle.section,
    row: params.vehicle.row,
    space: params.vehicle.space,
    detailsUrl: params.vehicle.detailsUrl,
    partsUrl: params.vehicle.partsUrl,
    pricesUrl: params.vehicle.pricesUrl,
    engine: params.vehicle.engine,
    trim: params.vehicle.trim,
    transmission: params.vehicle.transmission,
    firstSeenAt: params.firstSeenAt,
    lastSeenAt: params.runTimestamp,
    missingSinceAt: null,
    missingRunCount: 0,
  };
}

function insertVehicleChanges(
  tx: DbTransaction,
  rows: Array<typeof vehicleChange.$inferInsert>,
): Effect.Effect<void, PersistenceError> {
  return Effect.gen(function* () {
    for (const chunk of chunkValues(rows, VEHICLE_CHANGE_CHUNK_SIZE)) {
      yield* dbEffect("reconcile.insertVehicleChanges", () =>
        tx.insert(vehicleChange).values(chunk),
      );
    }
  });
}

function upsertVehicles(
  tx: DbTransaction,
  rows: Array<typeof vehicle.$inferInsert>,
): Effect.Effect<void, PersistenceError> {
  return Effect.gen(function* () {
    for (const chunk of chunkValues(rows, VEHICLE_UPSERT_CHUNK_SIZE)) {
      yield* dbEffect("reconcile.upsertVehicles", () =>
        tx
          .insert(vehicle)
          .values(chunk)
          .onConflictDoUpdate({
            target: vehicle.vin,
            set: {
              source: sql`excluded.source`,
              year: sql`excluded.year`,
              make: sql`excluded.make`,
              model: sql`excluded.model`,
              color: sql`excluded.color`,
              stockNumber: sql`excluded.stock_number`,
              imageUrl: sql`excluded.image_url`,
              availableDate: sql`excluded.available_date`,
              locationCode: sql`excluded.location_code`,
              locationName: sql`excluded.location_name`,
              state: sql`excluded.state`,
              stateAbbr: sql`excluded.state_abbr`,
              lat: sql`excluded.lat`,
              lng: sql`excluded.lng`,
              section: sql`excluded.section`,
              row: sql`excluded.row`,
              space: sql`excluded.space`,
              detailsUrl: sql`excluded.details_url`,
              partsUrl: sql`excluded.parts_url`,
              pricesUrl: sql`excluded.prices_url`,
              engine: sql`excluded.engine`,
              trim: sql`excluded.trim`,
              transmission: sql`excluded.transmission`,
              lastSeenAt: sql`excluded.last_seen_at`,
              missingSinceAt: null,
              missingRunCount: 0,
            },
          }),
      );
    }
  });
}

function updateMissingVehicles(
  tx: DbTransaction,
  missingTransitions: MissingTransition[],
): Effect.Effect<void, PersistenceError> {
  return Effect.gen(function* () {
    for (const transition of missingTransitions) {
      yield* dbEffect("reconcile.updateMissingVehicles", () =>
        tx
          .update(vehicle)
          .set({
            missingSinceAt: transition.missingSinceAt,
            missingRunCount: transition.missingRunCount,
          })
          .where(eq(vehicle.vin, transition.vin)),
      );
    }
  });
}

function deleteVehiclesByVin(
  tx: DbTransaction,
  vins: string[],
): Effect.Effect<void, PersistenceError> {
  return Effect.gen(function* () {
    for (const chunk of chunkValues(vins, VIN_DELETE_CHUNK_SIZE)) {
      yield* dbEffect("reconcile.deleteVehiclesByVin", () =>
        tx.delete(vehicle).where(inArray(vehicle.vin, chunk)),
      );
    }
  });
}

export function reconcileFromFinalInventory(
  options: ReconcileOptions,
): Effect.Effect<ReconcileResult, PersistenceError, Database> {
  return Effect.gen(function* () {
    const dbClient = yield* Database;

    if (
      options.finalInventoryByVin.size === 0 &&
      !options.allowAdvanceMissingState
    ) {
      return {
        upsertedCount: 0,
        deletedCount: 0,
        missingUpdatedCount: 0,
        skippedMissingAdvance: true,
        timingsMs: {
          readExistingMs: 0,
          planMs: 0,
          upsertWriteMs: 0,
          missingWriteMs: 0,
        },
      };
    }

    yield* Effect.logDebug(
      formatReconcileMemory("before_reconcile_reads", {
        finalVins: options.finalInventoryByVin.size,
      }),
    );

    const changedUpsertsResult = yield* collectChangedUpserts({
      finalInventoryByVin: options.finalInventoryByVin,
      runTimestamp: options.runTimestamp,
    });
    let readExistingMs = changedUpsertsResult.readExistingMs;
    let planMs = changedUpsertsResult.planMs;

    yield* Effect.logDebug(
      formatReconcileMemory("after_upsert_planning", {
        changedUpserts: changedUpsertsResult.changedUpserts.length,
      }),
    );

    let missingTransitions: MissingTransition[] = [];
    let deleteVins: string[] = [];
    let skippedMissingAdvance = false;

    if (options.allowAdvanceMissingState) {
      const missingResult = yield* collectMissingTransitions({
        finalInventoryByVin: options.finalInventoryByVin,
        runTimestamp: options.runTimestamp,
        missingDeleteAfterRuns: options.missingDeleteAfterRuns,
        missingDeleteAfterMs: options.missingDeleteAfterMs,
      });
      missingTransitions = missingResult.missingTransitions;
      deleteVins = missingResult.deleteVins;
      readExistingMs += missingResult.readExistingMs;
      planMs += missingResult.planMs;
      yield* Effect.logDebug(
        formatReconcileMemory("after_missing_scan", {
          missingTransitions: missingTransitions.length,
          deleteVins: deleteVins.length,
        }),
      );
    } else {
      skippedMissingAdvance = true;
    }

    let upsertWriteMs = 0;
    let missingWriteMs = 0;

    yield* dbTransactionEffect(dbClient, "reconcile.transaction", (tx) =>
      Effect.gen(function* () {
        if (changedUpsertsResult.changedUpserts.length > 0) {
          const upsertWriteStartedAt = Date.now();

          yield* insertVehicleChanges(
            tx,
            changedUpsertsResult.changedUpserts.map((entry) => ({
              runId: options.runId,
              vin: entry.vehicle.vin,
              changeType: "upsert",
              payload: null,
              payloadVersion: 1,
              createdAt: options.runTimestamp,
            })),
          );

          yield* upsertVehicles(
            tx,
            changedUpsertsResult.changedUpserts.map((entry) =>
              toVehicleRow({
                vehicle: entry.vehicle,
                firstSeenAt: entry.firstSeenAt,
                runTimestamp: options.runTimestamp,
              }),
            ),
          );

          upsertWriteMs = Date.now() - upsertWriteStartedAt;
        }

        if (missingTransitions.length > 0) {
          const missingWriteStartedAt = Date.now();

          yield* insertVehicleChanges(
            tx,
            missingTransitions.map((transition) => ({
              runId: options.runId,
              vin: transition.vin,
              changeType: transition.changeType,
              payload: null,
              payloadVersion: 1,
              createdAt: options.runTimestamp,
            })),
          );

          const missingOnly = missingTransitions.filter(
            (transition) => transition.changeType === "missing",
          );
          if (missingOnly.length > 0) {
            yield* updateMissingVehicles(tx, missingOnly);
          }

          if (deleteVins.length > 0) {
            yield* deleteVehiclesByVin(tx, deleteVins);
          }

          missingWriteMs = Date.now() - missingWriteStartedAt;
        }
      }),
    );

    return {
      upsertedCount: options.finalInventoryByVin.size,
      deletedCount: deleteVins.length,
      missingUpdatedCount: missingTransitions.filter(
        (transition) => transition.changeType === "missing",
      ).length,
      skippedMissingAdvance,
      timingsMs: {
        readExistingMs,
        planMs,
        upsertWriteMs,
        missingWriteMs,
      },
    };
  });
}
